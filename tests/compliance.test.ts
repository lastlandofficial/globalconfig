import { describe, it, expect } from "vitest";
import {
  calculateOrder,
  createReviewedTaxProvider,
  createComplianceExample,
  createInvoiceDraft,
  createCreditNoteDraft,
  validateInvoice,
  verifyCalculation,
  renderInvoiceHTML,
  createComplianceLock,
  compareRulePacks,
  digest,
} from "../src/compliance";
import { allocate } from "../src/compliance/engine";
import { checkSources } from "../src/compliance/sources";
import type { Calculation, Result } from "../src/compliance";
function ready<T>(r: Result<T>): T {
  if (r.status !== "ready") throw Error(JSON.stringify(r));
  return r.value;
}
describe("order accounting", () => {
  it("rejects malformed rules at the public provider boundary", () => {
    const { config } = createComplianceExample("JP");
    const rules = config.rules.treatments;
    expect(
      createReviewedTaxProvider(rules).resolve(
        "example-item",
        "JP",
        "2026-09-09",
      ).status,
    ).toBe("ready");
    rules[0]!.rate = "-10";
    expect(() => createReviewedTaxProvider(rules)).toThrow("Rate must be");
    rules[0]!.rate = "10";
    rules.push({ ...rules[0]! });
    expect(() => createReviewedTaxProvider(rules)).toThrow(
      "IDs must be unique",
    );
  });
  it("calculates each country with sourced decisions and immutable replayable snapshots", () => {
    for (const country of ["IN", "JP", "US"] as const) {
      const { config, order } = createComplianceExample(country);
      const c = ready(calculateOrder(config, order));
      expect(c.gross).toBe(
        country === "IN" ? "236.00" : country === "JP" ? "2200" : "214.50",
      );
      expect(verifyCalculation(c)).toBe(true);
      config.products[0]!.unitPrice = "999";
      expect(c.snapshot.config.products[0]!.unitPrice).not.toBe("999");
      expect(Object.isFrozen(c)).toBe(true);
    }
  });
  it("groups Japan fractional taxes by rate instead of rounding each item", () => {
    const { config, order } = createComplianceExample("JP");
    config.products[0]!.unitPrice = "15";
    order.lines = [
      { id: "a", productId: "example-item", quantity: 1 },
      { id: "b", productId: "example-item", quantity: 1 },
    ];
    const c = ready(calculateOrder(config, order));
    expect(c.net).toBe("30");
    expect(c.tax).toBe("3");
    expect(c.lines.map((l) => l.tax)).toEqual(["2", "1"]);
    config.products.push({
      id: "food",
      description: "Reviewed reduced example",
      unitPrice: "15",
    });
    config.rules.treatments.push({
      ...config.rules.treatments[0]!,
      id: "reduced",
      productId: "food",
      rate: "8",
    });
    order.lines.push({ id: "c", productId: "food", quantity: 1 });
    const mixed = ready(calculateOrder(config, order));
    expect(mixed.groups).toHaveLength(2);
    expect(mixed.tax).toBe("4");
  });
  it("reconciles inclusive pricing, mixed rates and discounts in integer minor units", () => {
    const { config, order } = createComplianceExample("JP");
    config.products[0]!.unitPrice = "110";
    order.pricing = "inclusive";
    order.lines = [
      { id: "a", productId: "example-item", quantity: 2, discount: "11" },
      { id: "b", productId: "example-item", quantity: 1 },
    ];
    order.discount = "22";
    const c = ready(calculateOrder(config, order));
    expect(c.gross).toBe("297");
    expect(c.tax).toBe("27");
    expect(c.net).toBe("270");
    expect(c.discount).toBe("33");
  });
  it("rounds India intra-state components individually and preserves equal rate components", () => {
    const { config, order } = createComplianceExample("IN");
    config.products[0]!.unitPrice = "0.03";
    order.lines[0]!.quantity = 1;
    const c = ready(calculateOrder(config, order));
    expect(c.tax).toBe("0.00");
    expect(c.groups[0]!.components.map((p) => p.amount)).toEqual([
      "0.00",
      "0.00",
    ]);
    order.supply = "inter-state";
    delete order.localTax;
    expect(ready(calculateOrder(config, order)).tax).toBe("0.01");
  });
  it("preserves allocation totals and bounds through many independent integer examples", () => {
    for (let total = 0n; total < 100n; total++)
      for (let a = 1n; a < 9n; a++) {
        const weights = [a, 11n - a, 3n];
        const values = allocate(total, weights);
        expect(values.reduce((x, y) => x + y, 0n)).toBe(total);
        values.forEach((v, i) => {
          const exact = total * weights[i]!;
          expect(v * 14n <= exact + 14n && v * 14n >= exact - 14n).toBe(true);
        });
      }
  });
  it("keeps unknown, ambiguous, expired, unsupported and invalid cases explicit", () => {
    const { config, order } = createComplianceExample("JP");
    config.rules.treatments = [];
    expect(calculateOrder(config, order).status).toBe("needs-context");
    const example = createComplianceExample("US");
    example.order.jurisdiction = "US-NY";
    expect(calculateOrder(example.config, example.order).status).toBe(
      "unsupported",
    );
    const a = createComplianceExample("JP");
    a.config.rules.treatments.push({
      ...a.config.rules.treatments[0]!,
      id: "duplicate",
    });
    expect(calculateOrder(a.config, a.order).status).toBe("needs-context");
    const b = createComplianceExample("JP");
    b.order.discount = "999999";
    expect(calculateOrder(b.config, b.order).status).toBe("invalid");
    const c = createComplianceExample("JP");
    c.order.date = "2027-01-01";
    expect(calculateOrder(c.config, c.order).status).toBe("needs-context");
    const d = createComplianceExample("JP");
    d.config.rules.requirements = [];
    expect(calculateOrder(d.config, d.order).status).toBe("invalid");
  });
  it("rejects unsupported input flags and does not silently interpret absent facts", () => {
    const { config, order } = createComplianceExample("IN");
    delete order.supply;
    expect(calculateOrder(config, order).status).toBe("needs-context");
    for (const change of [
      { unknown: true },
      { discount: -1 },
      { pricing: "guess" },
      { lines: [{ id: "a", productId: "example-item", quantity: 0 }] },
    ])
      expect(
        calculateOrder(config, { ...order, ...change } as never).status,
      ).toBe("invalid");
  });
  it("honors exclusive effectiveTo boundaries and keeps zero/exempt/excluded treatments distinct", () => {
    const { config, order } = createComplianceExample("US");
    config.rules.treatments[0]!.effectiveFrom = "2026-09-08";
    config.rules.treatments[0]!.effectiveTo = order.date;
    expect(calculateOrder(config, order).status).toBe("needs-context");
    delete config.rules.treatments[0]!.effectiveTo;
    for (const treatment of ["zero-rated", "exempt", "out-of-scope"] as const) {
      config.rules.treatments[0]!.treatment = treatment;
      config.rules.treatments[0]!.rate = "0";
      config.rules.treatments[0]!.reason = "Reviewed example";
      const c = ready(calculateOrder(config, order));
      expect(c.groups[0]!.treatment).toBe(treatment);
      expect(c.tax).toBe("0.00");
    }
  });
});
describe("invoices and credits", () => {
  it("validates country invoice fields and catches modified calculation snapshots", () => {
    for (const country of ["IN", "JP", "US"] as const) {
      const { config, order, details } = createComplianceExample(country);
      const invoice = ready(createInvoiceDraft(config, order, details));
      expect(validateInvoice(invoice).valid).toBe(true);
      const changed = JSON.parse(JSON.stringify(invoice));
      changed.calculation.gross = "1";
      expect(validateInvoice(changed).valid).toBe(false);
    }
    const { config, order, details } = createComplianceExample("IN");
    order.supply = "inter-state";
    delete order.localTax;
    delete order.placeOfSupply;
    const r = createInvoiceDraft(config, order, details);
    expect(r.status).toBe("needs-context");
    if (r.status !== "ready")
      expect(
        r.issues.some((i) => i.code === "IN-GST-INVOICE-PLACE-OF-SUPPLY"),
      ).toBe(true);
  });
  it("blocks unknown registration obligations and requires explicit external evidence", () => {
    const { config, order, details } = createComplianceExample("IN");
    config.business.india!.eInvoice = "required";
    expect(createInvoiceDraft(config, order, details).status).toBe(
      "needs-context",
    );
    details.externalRegistration = {
      irn: "a".repeat(64),
      signedQR: "verified external QR data",
      evidence: "external verification reference",
      verifiedBy: "reviewer",
      verifiedOn: details.issuedOn,
    };
    expect(createInvoiceDraft(config, order, details).status).toBe("ready");
  });
  it("allocates cumulative partial credits exactly and rejects duplicate/tampered history and over-refunds", () => {
    const { config, order, details } = createComplianceExample("JP");
    order.lines[0]!.quantity = 3;
    config.products[0]!.unitPrice = "15";
    const invoice = ready(createInvoiceDraft(config, order, details));
    const request = {
      number: "C1",
      date: order.date,
      reason: "Partial return",
      review: config.business.review!,
      lines: [{ lineId: "item-1", quantity: 1 }],
    };
    const a = ready(createCreditNoteDraft(invoice, request));
    const b = ready(
      createCreditNoteDraft(invoice, { ...request, number: "C2" }, [a]),
    );
    const c = ready(
      createCreditNoteDraft(invoice, { ...request, number: "C3" }, [a, b]),
    );
    expect([a, b, c].reduce((n, c) => n + Number(c.tax), 0)).toBe(
      Number(invoice.calculation.tax),
    );
    expect(
      createCreditNoteDraft(invoice, { ...request, number: "C4" }, [a, b, c])
        .status,
    ).toBe("invalid");
    expect(
      createCreditNoteDraft(invoice, { ...request, number: "C4" }, [a, a])
        .status,
    ).toBe("invalid");
    const bad = JSON.parse(JSON.stringify(a));
    bad.lines[0].tax = "0";
    expect(
      createCreditNoteDraft(invoice, { ...request, number: "C2" }, [bad])
        .status,
    ).toBe("invalid");
  });
  it("escapes invoice HTML and labels fictional data", () => {
    const { config, order, details } = createComplianceExample("JP");
    config.business.name = "<script>alert(1)</script>";
    const html = renderInvoiceHTML(
      ready(createInvoiceDraft(config, order, details)),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("TEST Invoice draft");
  });
  it("pins revisions and detects changed rule decisions", () => {
    const { config } = createComplianceExample("JP");
    const before = structuredClone(config.rules);
    const lock = createComplianceLock(config);
    config.rules.treatments[0]!.rate = "8";
    expect(createComplianceLock(config).rulesDigest).not.toBe(lock.rulesDigest);
    expect(compareRulePacks(before, config.rules).changes[0]!.kind).toBe(
      "changed",
    );
    expect(digest({ b: 1, a: 2 })).toBe(digest({ a: 2, b: 1 }));
  });
});
describe("official document monitoring", () => {
  it("distinguishes baseline absence, changes and unavailable sources without interpreting law", async () => {
    const { config } = createComplianceExample("JP");
    const source = config.rules.requirements.slice(0, 1);
    const fetcher = (async () =>
      new Response("official content")) as typeof fetch;
    const first = await checkSources(source, {}, fetcher);
    expect(first[0]!.status).toBe("not-checked");
    const baseline = { [source[0]!.source]: first[0]!.digest! };
    expect((await checkSources(source, baseline, fetcher))[0]!.status).toBe(
      "unchanged",
    );
    expect(
      (
        await checkSources(
          source,
          baseline,
          (async () => new Response("changed")) as typeof fetch,
        )
      )[0]!.status,
    ).toBe("changed");
    expect(
      (
        await checkSources(
          source,
          baseline,
          (async () => new Response("", { status: 503 })) as typeof fetch,
        )
      )[0]!.status,
    ).toBe("unavailable");
    expect(
      (
        await checkSources(
          source,
          baseline,
          (async () =>
            new Response("", {
              status: 302,
              headers: { location: "http://127.0.0.1/" },
            })) as typeof fetch,
        )
      )[0]!.status,
    ).toBe("unavailable");
  });
});

describe("government review evidence revisions", () => {
  it("keeps old assertions visible but marks them unverified against a changed rule", async () => {
    const { createLawsManager, lawRules } = await import("../src/laws");
    const first = createLawsManager({
      rules: [{ ...lawRules[0]!, reviewAfter: "2026-12-06" }],
    });
    first.record({
      ruleId: "in-dpdp",
      controlId: "commencement-review",
      status: "done",
      note: "Reviewed commencement",
      updatedAt: "2026-09-09T00:00:00Z",
    });
    const saved = JSON.parse(JSON.stringify(first.exportRecords()));
    expect(
      first.plan({ country: "IN", on: "2026-09-09" }).evidence
        .recordedForRevision,
    ).toBe(1);
    expect(
      first.assess({ country: "IN", on: "2026-09-09" }).items[0]!
        .sourceReviewRequired,
    ).toBe(false);
    const next = createLawsManager({
      rules: [
        {
          ...lawRules[0]!,
          summary: "Revised scope",
          reviewAfter: "2026-12-06",
        },
      ],
      records: saved,
    });
    const plan = next.plan({ country: "IN" });
    expect(plan.evidence.requiresReview).toBe(1);
    expect(plan.tasks[0]!.status).toBe("done");
    expect(plan.tasks[0]!.verification).toBe("review-required");
  });
});
