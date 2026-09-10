import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile),
  cli = resolve("bin/glocon.mjs");
async function run(dir, ...args) {
  try {
    return {
      ...(await exec(process.execPath, [cli, ...args, "--dir", dir])),
      code: 0,
    };
  } catch (e) {
    return e;
  }
}
test("CLI demo setup, quote, invoice, report, lock mismatch and preservation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "glocon-finance-cli-"));
  try {
    assert.equal(
      (await run(dir, "compliance", "init", "--country", "JP", "--demo")).code,
      0,
    );
    const config = await readFile(join(dir, "glocon.compliance.json"), "utf8");
    assert.match(
      (await run(dir, "compliance", "init", "--country", "JP", "--demo"))
        .stdout,
      /Preserved/,
    );
    assert.equal(
      await readFile(join(dir, "glocon.compliance.json"), "utf8"),
      config,
    );
    assert.equal((await run(dir, "compliance", "check")).code, 0);
    const quote = await run(dir, "tax", "quote", "glocon.examples/order.json");
    assert.equal(quote.code, 0);
    assert.equal(JSON.parse(quote.stdout).value.gross, "2200");
    assert.equal(
      (
        await run(
          dir,
          "invoice",
          "create",
          "glocon.examples/order.json",
          "--details",
          "glocon.examples/invoice-details.json",
          "--output",
          "invoice.json",
        )
      ).code,
      0,
    );
    assert.equal(
      (await run(dir, "invoice", "validate", "invoice.json")).code,
      0,
    );
    assert.equal(
      (
        await run(
          dir,
          "invoice",
          "render",
          "invoice.json",
          "--output",
          "invoice.html",
        )
      ).code,
      0,
    );
    assert.match(
      await readFile(join(dir, "invoice.html"), "utf8"),
      /TEST Invoice draft/,
    );
    const changed = JSON.parse(config);
    changed.products[0].unitPrice = "1200";
    await writeFile(
      join(dir, "glocon.compliance.json"),
      JSON.stringify(changed),
    );
    assert.equal((await run(dir, "compliance", "check")).code, 2);
    await assert.rejects(readFile(join(dir, ".glocon/compliance-report.json")), { code: "ENOENT" });
    assert.equal((await run(dir, "compliance", "lock")).code, 0);
    assert.equal((await run(dir, "compliance", "check")).code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("production setup leaves treatment and registration decisions unresolved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "glocon-finance-production-"));
  try {
    assert.equal(
      (await run(dir, "compliance", "init", "--country", "IN")).code,
      0,
    );
    assert.equal((await run(dir, "compliance", "check")).code, 2);
    const r = JSON.parse(
      (await run(dir, "tax", "quote", "glocon.examples/order.json")).stdout,
    );
    assert.equal(r.status, "needs-context");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
