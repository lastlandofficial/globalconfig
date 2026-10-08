import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateOrder,
  checkFinancialCases,
  createComplianceExample,
  createComplianceLock,
  createInvoiceDraft,
  createCreditNoteDraft,
  digest,
  replayCalculation,
  verifyCalculation,
  type Calculation,
  type Result,
} from "../src/compliance";
import { formatCurrency } from "../src/currency";

function ready<T>(result: Result<T>): T {
  if (result.status !== "ready") throw Error(JSON.stringify(result));
  return result.value;
}
function resigned(calculation: Calculation): Calculation {
  const { digest: _oldDigest, ...body } = calculation;
  return { ...body, digest: digest(body) };
}
const legacyFixtures = [
  "../fixtures/compliance-v0.6.snapshots.json",
  "../fixtures/compliance-v0.7.engine2.snapshots.json",
].flatMap((path) => {
  const fixture = JSON.parse(
    readFileSync(new URL(path, import.meta.url), "utf8"),
  ) as {
    snapshots: { calculation: Calculation }[];
  };
  return fixture.snapshots.map(({ calculation }) => calculation);
});

describe("versioned financial replay", () => {
  it("preserves complete immutable engine 1 and 2 snapshots while new calls use engine 3", () => {
    expect(new Set(legacyFixtures.map((value) => value.engine))).toEqual(
      new Set(["glocon-order-1", "glocon-order-2"]),
    );
    for (const calculation of legacyFixtures) {
      expect(verifyCalculation(calculation)).toBe(true);
      expect(ready(replayCalculation(calculation))).toEqual(calculation);
      const current = ready(
        calculateOrder(calculation.snapshot.config, calculation.snapshot.order),
      );
      expect(current.engine).toBe("glocon-order-3");
      expect(current.profile).toBe("glocon-ordinary-domestic-1");
      expect(current.net).toBe(calculation.net);
      expect(current.tax).toBe(calculation.tax);
      expect(current.gross).toBe(calculation.gross);
      expect(createComplianceLock(calculation.snapshot.config).engine).toBe(
        "glocon-order-3",
      );
    }
  });

  it("does not accept tampered financial output, pinned text, profile sources, or engine labels after rehashing", () => {
    for (const original of legacyFixtures) {
      for (const edit of [
        (c: Calculation) => {
          c.gross = "1";
        },
        (c: Calculation) => {
          c.limitations[0] = "Changed explanatory sentence";
        },
        (c: Calculation) => {
          c.snapshot.config.rules.requirements[0]!.source =
            "https://example.com/changed";
        },
        (c: Calculation) => {
          c.engine =
            c.engine === "glocon-order-1" ? "glocon-order-2" : "glocon-order-1";
        },
      ]) {
        const changed = structuredClone(original);
        edit(changed);
        expect(verifyCalculation(resigned(changed))).toBe(false);
      }
    }
    const current = ready(
      calculateOrder(
        ...(() => {
          const { config, order } = createComplianceExample("JP");
          return [config, order] as const;
        })(),
      ),
    );
    const withoutProfile = structuredClone(current);
    delete withoutProfile.profile;
    expect(verifyCalculation(resigned(withoutProfile))).toBe(false);
    const unknownEngine = {
      ...current,
      engine: "glocon-order-999",
    } as unknown as Calculation;
    expect(replayCalculation(unknownEngine).status).toBe("invalid");
  });

  it("retains historical lexical acceptance without exposing it in new calculations", () => {
    const original = legacyFixtures.find(
      (c) => c.country === "JP" && c.engine === "glocon-order-1",
    )!;
    const signed = structuredClone(original);
    signed.snapshot.order.discount = "+0";
    expect(verifyCalculation(resigned(signed))).toBe(true);
    expect(
      calculateOrder(signed.snapshot.config, signed.snapshot.order).status,
    ).toBe("invalid");

    const padded = structuredClone(original);
    const price = `${padded.snapshot.config.products[0]!.unitPrice}.${"0".repeat(1100)}`;
    padded.snapshot.config.products[0]!.unitPrice = price;
    padded.lines[0]!.unitPrice = price;
    expect(verifyCalculation(resigned(padded))).toBe(true);
    expect(
      calculateOrder(padded.snapshot.config, padded.snapshot.order).status,
    ).toBe("invalid");
  });

  it("replays padded historical metered quantities through invoice and credit history", () => {
    const original = legacyFixtures.find(
      (c) => c.country === "JP" && c.engine === "glocon-order-2",
    )!;
    const padded = structuredClone(original);
    const quantity = `0.3${"0".repeat(1100)}`;
    padded.snapshot.order.lines[0]!.quantity = quantity;
    padded.lines[0]!.quantity = quantity;
    const calculation = resigned(padded);
    expect(verifyCalculation(calculation)).toBe(true);
    const invoiceBody = {
      kind: "invoice" as const,
      version: 1 as const,
      status: "draft" as const,
      details: { number: "INV/2026/1", issuedOn: "2026-09-09" },
      calculation,
    };
    const invoice = { ...invoiceBody, digest: digest(invoiceBody) };
    const request = {
      number: "C1",
      date: invoice.details.issuedOn,
      reason: "Historical quantity replay",
      review: { ...original.snapshot.config.business.review! },
      lines: [
        { lineId: original.lines[0]!.id, quantity: `0.1${"0".repeat(1100)}` },
      ],
    };
    const first = ready(createCreditNoteDraft(invoice, request));
    expect(first.version).toBe(1);
    expect(
      ready(
        createCreditNoteDraft(invoice, { ...request, number: "C2" }, [first]),
      ).version,
    ).toBe(1);
  });
});

describe("current financial boundaries", () => {
  it("compares supported Japan rates exactly before performing exact tax arithmetic", () => {
    const { config, order } = createComplianceExample("JP");
    config.products[0]!.unitPrice = "5";
    order.lines[0]!.quantity = 1;
    for (const rate of [
      "7.999999999999999999",
      "8.000000000000000001",
      "9.999999999999999999",
      "10.000000000000000001",
    ]) {
      config.rules.treatments[0]!.rate = rate;
      expect(calculateOrder(config, order).status).toBe("unsupported");
    }
    for (const rate of ["10", "10.000000000000000000", "010.0"]) {
      config.rules.treatments[0]!.rate = rate;
      expect(ready(calculateOrder(config, order)).tax).toBe("1");
    }
  });

  it("rejects extended, tax-added and aggregate amounts crossing the common money bound", () => {
    const { config, order } = createComplianceExample("JP");
    config.products[0]!.unitPrice = "999999999999999999999999999999";
    order.lines[0]!.quantity = 2;
    expect(calculateOrder(config, order).status).toBe("invalid");
    order.lines[0]!.quantity = 1;
    expect(calculateOrder(config, order).status).toBe("invalid");
    config.products[0]!.unitPrice = "500000000000000000000000000000";
    order.lines = [
      { id: "a", productId: "example-item", quantity: 1 },
      { id: "b", productId: "example-item", quantity: 1 },
    ];
    expect(calculateOrder(config, order).status).toBe("invalid");
    order.lines = order.lines.map((line) => ({
      ...line,
      discount: config.products[0]!.unitPrice,
    }));
    expect(calculateOrder(config, order).status).toBe("invalid");
    order.lines = [{ id: "a", productId: "example-item", quantity: 1 }];
    const calculation = ready(calculateOrder(config, order));
    expect(() => formatCurrency(calculation.gross, "JPY")).not.toThrow();
    expect(
      checkFinancialCases(
        config,
        [
          {
            name: "supported large calculation",
            order,
            expected: {
              status: "ready",
              net: calculation.net,
              tax: calculation.tax,
              gross: calculation.gross,
            },
          },
        ],
        { scope: "quotes" },
      ).exitCode,
    ).toBe(0);
  });

  it("uses explicit applicability starts for business, source, treatment and billing reviews", () => {
    for (const kind of [
      "business",
      "source",
      "treatment",
      "billing",
    ] as const) {
      const { config, order, details } = createComplianceExample("JP");
      if (kind === "billing")
        config.billing = {
          quantityPrecision: 0,
          unitPricePrecision: 0,
          lineRounding: "half-up",
          review: { ...config.business.review! },
        };
      if (kind === "source") {
        config.rules.requirements[0]!.reviewedOn = "2026-10-08";
      } else {
        const owner =
          kind === "business"
            ? config.business
            : kind === "treatment"
              ? config.rules.treatments[0]!
              : config.billing!;
        owner.review = { ...owner.review!, on: "2026-10-08" };
      }
      expect(calculateOrder(config, order).status).toBe("needs-context");
      if (kind === "source")
        config.rules.requirements[0]!.reviewAppliesFrom = order.date;
      else {
        const owner =
          kind === "business"
            ? config.business
            : kind === "treatment"
              ? config.rules.treatments[0]!
              : config.billing!;
        owner.review!.appliesFrom = order.date;
      }
      const retrospective = ready(calculateOrder(config, order));
      expect(verifyCalculation(retrospective)).toBe(true);
      details.issuedOn = "2026-10-08";
      expect(createInvoiceDraft(config, order, details).status).toBe("ready");
    }
  });

  it("keeps review deadlines exclusive for every current review kind", () => {
    for (const kind of [
      "business",
      "source",
      "treatment",
      "billing",
    ] as const) {
      const { config, order } = createComplianceExample("JP");
      const review = {
        ...config.business.review!,
        on: "2026-09-08",
        after: order.date,
      };
      if (kind === "business") config.business.review = review;
      if (kind === "treatment") config.rules.treatments[0]!.review = review;
      if (kind === "billing")
        config.billing = {
          quantityPrecision: 0,
          unitPricePrecision: 0,
          lineRounding: "half-up",
          review,
        };
      if (kind === "source") {
        config.rules.requirements[0]!.reviewedOn = review.on;
        config.rules.requirements[0]!.reviewAfter = review.after;
      }
      expect(calculateOrder(config, order).status).toBe("needs-context");
    }
  });
});
