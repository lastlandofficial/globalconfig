import { describe, expect, it } from "vitest";
import {
  calculateOrder,
  createComplianceExample,
  createInvoiceDraft,
  createCreditNoteDraft,
  createComplianceLock,
  defineComplianceConfig,
  verifyCalculation,
  validateInvoice,
  renderInvoiceHTML,
  type Result,
  type BillingPolicy,
  type CreditNoteDraft,
} from "../src/compliance";

function ready<T>(result: Result<T>): T {
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.value;
}
function metered(country: "IN" | "JP" | "US" = "US") {
  const example = createComplianceExample(country);
  example.config.billing = {
    quantityPrecision: 6,
    unitPricePrecision: 6,
    lineRounding: "half-up",
    review: example.config.business.review!,
  };
  example.config.products[0]!.unitPrice = "0.335";
  example.order.lines[0]!.quantity = "1.5";
  return example;
}
describe("reviewed fractional billing", () => {
  it("extends exact catalog prices and decimal-string quantities before rounding the line charge", () => {
    const { config, order, details } = metered();
    const calculation = ready(calculateOrder(config, order));
    expect(calculation.engine).toBe("glocon-order-2");
    expect(calculation.lines[0]).toMatchObject({
      quantity: "1.5",
      unitPrice: "0.335",
      net: "0.50",
      tax: "0.04",
      gross: "0.54",
    });
    expect(createComplianceLock(config).engine).toBe("glocon-order-2");
    expect(verifyCalculation(calculation)).toBe(true);
    const invoice = ready(createInvoiceDraft(config, order, details));
    expect(validateInvoice(invoice).valid).toBe(true);
    expect(renderInvoiceHTML(invoice)).toContain("1.5 each");
  });
  it("uses the reviewed line rounding independently of tax rounding", () => {
    const { config, order } = metered();
    config.products[0]!.unitPrice = "0.105";
    order.lines[0]!.quantity = "1";
    const net = (lineRounding: BillingPolicy["lineRounding"]) => {
      config.billing!.lineRounding = lineRounding;
      return ready(calculateOrder(config, order)).net;
    };
    expect(net("half-up")).toBe("0.11");
    expect(net("half-even")).toBe("0.10");
    expect(net("down")).toBe("0.10");
    expect(net("up")).toBe("0.11");
  });
  it("requires explicit precision and a review covering the transaction date", () => {
    const { config, order } = metered();
    const original = structuredClone(config.billing!);
    delete config.billing;
    expect(calculateOrder(config, order).status).toBe("invalid");
    config.billing = structuredClone(original);
    config.billing.review = {
      ...original.review,
      on: "2026-09-08",
      after: order.date,
    };
    const expired = calculateOrder(config, order);
    expect(expired.status).toBe("needs-context");
    if (expired.status !== "ready")
      expect(expired.issues.some((i) => i.code === "BILLING-REVIEW")).toBe(
        true,
      );
    config.billing.review = { ...original.review, on: "2026-10-01" };
    expect(calculateOrder(config, order).status).toBe("needs-context");
  });
  it("rejects binary fractional quantities, malformed decimals and precision overflows", () => {
    const { config, order } = metered();
    for (const quantity of [
      0.1,
      NaN,
      Infinity,
      "0",
      "-1",
      "1e-3",
      "0.0000001",
      "1000000.000001",
      " 1.5",
    ]) {
      order.lines[0]!.quantity = quantity;
      expect(calculateOrder(config, order).status).toBe("invalid");
    }
    order.lines[0]!.quantity = "1.5";
    for (const change of [
      { quantityPrecision: 19 },
      { unitPricePrecision: -1 },
      { lineRounding: "invalid" },
      { review: undefined },
    ]) {
      expect(() =>
        defineComplianceConfig({
          ...config,
          billing: { ...config.billing, ...change },
        }),
      ).toThrow();
    }
    config.products[0]!.unitPrice = "0.0000001";
    expect(calculateOrder(config, order).status).toBe("invalid");
  });
  it("keeps discounts in minor units and rejects discounted negative or excessive amounts", () => {
    const { config, order } = metered();
    config.products[0]!.unitPrice = "10.125";
    order.lines[0]!.quantity = "0.5";
    order.lines[0]!.discount = "0.01";
    order.discount = "0.01";
    expect(ready(calculateOrder(config, order)).net).toBe("5.04");
    order.lines[0]!.discount = "5.07";
    expect(calculateOrder(config, order).status).toBe("invalid");
    order.lines[0]!.discount = "0.001";
    expect(calculateOrder(config, order).status).toBe("invalid");
    order.lines[0]!.discount = "0";
    config.products[0]!.unitPrice = "999999999999999999999999999999.99";
    order.lines[0]!.quantity = "2";
    expect(calculateOrder(config, order).status).toBe("invalid");
  });
  it("supports the maximum declared decimal precision without floating-point drift", () => {
    const { config, order } = metered("JP");
    config.billing!.quantityPrecision = 18;
    config.billing!.unitPricePrecision = 18;
    config.products[0]!.unitPrice = "999999999999999999.123456789012345678";
    order.lines[0]!.quantity = "0.000000000000000001";
    expect(ready(calculateOrder(config, order)).net).toBe("1");
    config.products[0]!.unitPrice = "1000000000000000000";
    expect(ready(calculateOrder(config, order)).net).toBe("1");
  });
});
describe("fractional credits", () => {
  it("allocates cumulative quantities exactly and collects every remaining minor unit on full credit", () => {
    const { config, order, details } = metered("JP");
    config.products[0]!.unitPrice = "10.1";
    order.lines[0]!.quantity = "0.3";
    const original = ready(createInvoiceDraft(config, order, details));
    const base = {
      date: order.date,
      reason: "Reviewed partial return",
      review: config.business.review!,
      lines: [{ lineId: "item-1", quantity: "0.1" }],
    };
    const a = ready(createCreditNoteDraft(original, { ...base, number: "C1" }));
    const b = ready(
      createCreditNoteDraft(original, { ...base, number: "C2" }, [a]),
    );
    const c = ready(
      createCreditNoteDraft(original, { ...base, number: "C3" }, [a, b]),
    );
    expect([a, b, c].map((c) => c.net)).toEqual(["1", "1", "1"]);
    expect(
      [a, b, c].reduce((sum, c) => sum + BigInt(c.gross), 0n).toString(),
    ).toBe(original.calculation.gross);
    expect(
      createCreditNoteDraft(original, { ...base, number: "C4" }, [a, b, c])
        .status,
    ).toBe("invalid");
    const altered = structuredClone(a);
    altered.lines[0]!.quantity = "0.100001";
    expect(
      createCreditNoteDraft(original, { ...base, number: "C2" }, [altered])
        .status,
    ).toBe("invalid");
  });
  it("handles non-divisible tax remainders and sub-unit quantities", () => {
    const { config, order, details } = metered("JP");
    config.products[0]!.unitPrice = "50";
    order.lines[0]!.quantity = "0.3";
    const original = ready(createInvoiceDraft(config, order, details));
    const history: CreditNoteDraft[] = [];
    for (const number of ["C1", "C2", "C3"])
      history.push(
        ready(
          createCreditNoteDraft(
            original,
            {
              number,
              date: order.date,
              reason: "Return",
              review: config.business.review!,
              lines: [{ lineId: "item-1", quantity: "0.1" }],
            },
            history,
          ),
        ),
      );
    expect(history.map((c) => c.tax)).toEqual(["0", "1", "1"]);
    expect(
      history.reduce((sum, c) => sum + BigInt(c.gross), 0n).toString(),
    ).toBe(original.calculation.gross);
  });
});
