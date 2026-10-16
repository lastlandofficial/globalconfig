import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateOrder,
  replayCalculation,
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
const meteredFixture = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/compliance-v0.7.engine2.snapshots.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("historical engine 1 and 2 calculation, invoice and credit digests replay unchanged", () => {
  assert.equal(fixture.generatedWith, "glocon@0.6.0");
  for (const { calculation, invoice, country, tiny, credits } of [
    ...fixture.snapshots,
    ...meteredFixture.snapshots,
  ]) {
    const label = `${country} ${tiny ? "fractional-tax" : "ordinary"} legacy snapshot`;
    assert.equal(verifyCalculation(calculation), true, label);
    assert.equal(validateInvoice(invoice).valid, true, label);
    const replay = replayCalculation(calculation);
    assert.equal(replay.status, "ready", label);
    assert.deepEqual(replay.value, calculation, label);
    const current = calculateOrder(
      calculation.snapshot.config,
      calculation.snapshot.order,
    );
    assert.equal(current.status, "ready", label);
    assert.equal(current.value.engine, "glocon-order-3", label);
    for (const field of ["net", "tax", "gross", "discount"])
      assert.equal(current.value[field], calculation[field], label);
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
