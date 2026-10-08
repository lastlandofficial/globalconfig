import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createComplianceExample,
  createCreditNoteDraft,
  createInvoiceDraft,
  digest,
  replayCalculation,
  type CreditNoteDraft,
  type CreditRequest,
  type InvoiceDraft,
  type Result,
} from "../src/compliance";

function ready<T>(result: Result<T>): T {
  if (result.status !== "ready") throw Error(JSON.stringify(result));
  return result.value;
}
function example() {
  const { config, order, details } = createComplianceExample("JP");
  order.lines[0]!.quantity = 4;
  const invoice = ready(createInvoiceDraft(config, order, details));
  const request: CreditRequest = {
    number: "C1",
    date: order.date,
    reason: "Reviewed return",
    review: config.business.review!,
    lines: [{ lineId: "item-1", quantity: 1 }],
  };
  return { config, order, details, invoice, request };
}
function rehash<T extends { digest: string }>(value: T): T {
  const { digest: _, ...body } = value;
  return { ...value, digest: digest(body) };
}

describe("versioned financial credit histories", () => {
  it("stores one predecessor and rejects omitted, reordered, forged and unsupported histories", () => {
    const { invoice, request } = example();
    const a = ready(
      createCreditNoteDraft(invoice, request, [], { version: 2 }),
    );
    const b = ready(
      createCreditNoteDraft(invoice, { ...request, number: "C2" }, [a]),
    );
    const c = ready(
      createCreditNoteDraft(invoice, { ...request, number: "C3" }, [a, b]),
    );
    expect(a.version).toBe(2);
    expect(b.version).toBe(2);
    if (a.version !== 2 || b.version !== 2)
      throw Error("Expected compact credits");
    expect(a.previousDigest).toBeNull();
    expect(a.historyLength).toBe(0);
    expect(b.previousDigest).toBe(a.digest);
    expect(b.historyLength).toBe(1);
    expect("previousDigests" in c).toBe(false);
    const next = { ...request, number: "C4" };
    expect(createCreditNoteDraft(invoice, next, [a, c]).status).toBe("invalid");
    expect(createCreditNoteDraft(invoice, next, [b, a, c]).status).toBe(
      "invalid",
    );
    expect(createCreditNoteDraft(invoice, next, [a, b, b]).status).toBe(
      "invalid",
    );
    const changed = structuredClone(b);
    changed.net = "1";
    changed.lines[0]!.net = "1";
    expect(
      createCreditNoteDraft(invoice, next, [a, rehash(changed)]).status,
    ).toBe("invalid");
    const wrongHead = rehash({ ...b, previousDigest: "f".repeat(64) });
    expect(createCreditNoteDraft(invoice, next, [a, wrongHead]).status).toBe(
      "invalid",
    );
    const wrongCount = rehash({ ...b, historyLength: 0 });
    expect(createCreditNoteDraft(invoice, next, [a, wrongCount]).status).toBe(
      "invalid",
    );
    const unsupported = { ...b, version: 3 } as unknown as CreditNoteDraft;
    expect(createCreditNoteDraft(invoice, next, [a, unsupported]).status).toBe(
      "invalid",
    );
  });

  it("replays original legacy documents unchanged and upgrades their complete history explicitly", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL("../fixtures/compliance-v0.6.snapshots.json", import.meta.url),
        "utf8",
      ),
    ) as { snapshots: { invoice: InvoiceDraft; credits: CreditNoteDraft[] }[] };
    const legacy = fixtures.snapshots.find(
      (entry) => entry.credits.length > 1,
    )!;
    const originalCredit = legacy.credits[0]!;
    const replay = ready(
      createCreditNoteDraft(legacy.invoice, originalCredit.request),
    );
    expect(replay).toEqual(originalCredit);
    const secondRequest = legacy.credits[1]!.request;
    const upgraded = ready(
      createCreditNoteDraft(legacy.invoice, secondRequest, [replay], {
        version: 2,
      }),
    );
    expect(upgraded.version).toBe(2);
    if (upgraded.version !== 2) throw Error("Expected upgraded credit");
    expect(upgraded.previousDigest).toBe(replay.digest);
    expect(upgraded.net).toBe(legacy.credits[1]!.net);
    expect(upgraded.tax).toBe(legacy.credits[1]!.tax);
    const futureReview = {
      ...originalCredit.request,
      review: { ...originalCredit.request.review, on: "2026-09-10" },
    };
    expect(
      createCreditNoteDraft(legacy.invoice, futureReview, [], { version: 1 })
        .status,
    ).toBe("ready");
    expect(
      createCreditNoteDraft(legacy.invoice, futureReview, [], { version: 2 })
        .status,
    ).toBe("invalid");
  });

  it("keeps hundreds of fractional credits compact while independently conserving every minor unit", () => {
    const { config, order, details } = createComplianceExample("JP");
    config.billing = {
      quantityPrecision: 2,
      unitPricePrecision: 2,
      lineRounding: "half-up",
      review: config.business.review!,
    };
    config.products[0]!.unitPrice = "15";
    order.lines[0]!.quantity = "3";
    const invoice = ready(createInvoiceDraft(config, order, details));
    const history: CreditNoteDraft[] = [];
    const request: CreditRequest = {
      number: "C0",
      date: order.date,
      reason: "Reviewed fractional return",
      review: config.business.review!,
      lines: [{ lineId: "item-1", quantity: "0.01" }],
    };
    for (let index = 0; index < 256; index++) {
      history.push(
        ready(
          createCreditNoteDraft(
            invoice,
            { ...request, number: `C${index}` },
            history,
            { version: 2 },
          ),
        ),
      );
    }
    const firstHalfBytes = JSON.stringify(history.slice(0, 128)).length;
    const allBytes = JSON.stringify(history).length;
    expect(allBytes).toBeLessThan(firstHalfBytes * 2.2);
    expect(allBytes).toBeLessThan(300000);
    const last = ready(
      createCreditNoteDraft(
        invoice,
        {
          ...request,
          number: "FINAL",
          lines: [{ lineId: "item-1", quantity: "0.44" }],
        },
        history,
      ),
    );
    for (const field of ["net", "tax", "gross"] as const) {
      const credited = [...history, last].reduce(
        (total, credit) => total + BigInt(credit[field]),
        0n,
      );
      expect(credited).toBe(BigInt(invoice.calculation[field]));
    }
    expect(
      createCreditNoteDraft(invoice, { ...request, number: "EXTRA" }, [
        ...history,
        last,
      ]).status,
    ).toBe("invalid");
  }, 20000);

  it("retains historical fractional input acceptance for original quantities and complete mixed credit histories", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/compliance-v0.7.engine2.snapshots.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      snapshots: {
        country: string;
        invoice: InvoiceDraft;
        credits: CreditNoteDraft[];
      }[];
    };
    const legacy = fixtures.snapshots.find((entry) => entry.country === "JP")!;
    const calculation = structuredClone(legacy.invoice.calculation);
    calculation.snapshot.order.lines[0]!.quantity = `0.3${"0".repeat(1100)}`;
    const original = rehash({
      ...legacy.invoice,
      calculation: ready(replayCalculation(calculation)),
    });
    const firstRequest = {
      ...legacy.credits[0]!.request,
      lines: [{ lineId: "item-1", quantity: `0.1${"0".repeat(1100)}` }],
    };
    const a = ready(createCreditNoteDraft(original, firstRequest));
    expect(a.version).toBe(1);
    expect(
      createCreditNoteDraft(original, firstRequest, [], { version: 2 }).status,
    ).toBe("invalid");
    const b = ready(
      createCreditNoteDraft(original, legacy.credits[1]!.request, [a], {
        version: 2,
      }),
    );
    const c = ready(
      createCreditNoteDraft(original, legacy.credits[2]!.request, [a, b]),
    );
    expect(c.version).toBe(2);
    expect(BigInt(a.gross) + BigInt(b.gross) + BigInt(c.gross)).toBe(
      BigInt(original.calculation.gross),
    );
  });

  it("bounds history size before replaying oversized caller histories", () => {
    const { invoice, request } = example();
    const oversized = new Array<CreditNoteDraft>(10001);
    const result = createCreditNoteDraft(invoice, request, oversized);
    expect(result.status).toBe("invalid");
    if (result.status === "ready") throw Error("Expected invalid history");
    expect(result.issues[0]!.message).toContain(
      "Credit history must contain 0–10000 entries",
    );
  });

  it("requires current issuance and credit reviews to have happened before document dates", () => {
    const { config, order, details, invoice, request } = example();
    config.rules.treatments[0]!.review = {
      ...config.rules.treatments[0]!.review,
      on: "2026-09-10",
      appliesFrom: order.date,
    };
    expect(createInvoiceDraft(config, order, details).status).toBe(
      "needs-context",
    );
    expect(
      createInvoiceDraft(config, order, { ...details, issuedOn: "2026-09-10" })
        .status,
    ).toBe("ready");
    const futureReview = {
      ...request,
      review: {
        ...request.review,
        on: "2026-09-10",
        appliesFrom: request.date,
      },
    };
    expect(createCreditNoteDraft(invoice, futureReview).status).toBe("invalid");
  });
});
