import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateOrder,
  verifyCalculation,
  validateInvoice,
  createCreditNoteDraft,
} from "../dist/compliance/index.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/compliance-v0.6.snapshots.json", import.meta.url),
    "utf8",
  ),
);
test("0.6 calculation and invoice digests replay unchanged in 0.7", () => {
  assert.equal(fixture.generatedWith, "glocon@0.6.0");
  for (const {
    calculation,
    invoice,
    country,
    tiny,
    credits,
  } of fixture.snapshots) {
    const label = `${country} ${tiny ? "fractional-tax" : "ordinary"} legacy snapshot`;
    assert.equal(verifyCalculation(calculation), true, label);
    assert.equal(validateInvoice(invoice).valid, true, label);
    const replay = calculateOrder(
      calculation.snapshot.config,
      calculation.snapshot.order,
    );
    assert.equal(replay.status, "ready", label);
    assert.deepEqual(replay.value, calculation, label);
    for (const [index, credit] of credits.entries()) {
      const replayedCredit = createCreditNoteDraft(
        invoice,
        credit.request,
        credits.slice(0, index),
      );
      assert.equal(replayedCredit.status, "ready", label);
      assert.deepEqual(replayedCredit.value, credit, label);
    }
  }
});
