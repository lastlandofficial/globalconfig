import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "globalconfig-managers-"));
try {
  // Optional argument verifies the published GitHub URL instead of a locally packed tarball.
  const archive =
    process.argv[2] ??
    join(
      temp,
      JSON.parse(
        execFileSync(
          "npm",
          ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
          { cwd: root, encoding: "utf8" },
        ),
      )[0].filename,
    );
  for (const manager of ["npm", "pnpm", "yarn", "bun"]) {
    const cwd = join(temp, manager);
    mkdirSync(cwd);
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: `globalconfig-${manager}-consumer`,
        private: true,
        version: "1.0.0",
        type: "module",
      }),
    );
    const args =
      manager === "npm"
        ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive]
        : manager === "yarn"
          ? ["add", "--ignore-scripts", "--non-interactive", archive]
          : ["add", "--ignore-scripts", archive];
    execFileSync(manager, args, { cwd, stdio: "pipe" });
    const smoke = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createGlobalConfig, convertLocalTime } from 'glocon';
import { calculateOrder, createMeteredComplianceExample, createInvoiceDraft, createCreditNoteDraft } from 'glocon/compliance';
const require = createRequire(import.meta.url);
assert.equal(createGlobalConfig({ country: 'JP' }).tax.calculate({ country: 'JP', amount: '1000', category: 'standard' }).gross, '1100');
assert.equal(require('glocon/currency').toMinorUnits('1.005', 'USD'), 101n);
assert.equal(convertLocalTime('2026-09-01T09:00', { from: 'America/New_York', to: 'JP' }).local, '2026-09-01T22:00:00');
const sample = createMeteredComplianceExample('JP');
const quote = calculateOrder(sample.config, sample.order);
assert.equal(quote.status, 'ready');
assert.equal(quote.value.engine, 'glocon-order-3');
assert.equal(quote.value.gross, '17');
assert.deepEqual(require('glocon/compliance').calculateOrder(sample.config, sample.order), quote);
const invoice = createInvoiceDraft(sample.config, sample.order, sample.details);
assert.equal(invoice.status, 'ready');
const history = [];
for (const gross of ['5','6','6']) {
  const credit = createCreditNoteDraft(invoice.value, { number: 'CINV/2026/' + (history.length + 1), date: sample.order.date, reason: 'Reviewed metered fixture', review: sample.config.business.review, lines: [{lineId:'item-1',quantity:'0.1'}] }, history);
  assert.equal(credit.status, 'ready');
  assert.equal(credit.value.gross, gross);
  history.push(credit.value);
}
for (const entry of ['countries', 'currency', 'time', 'tax', 'laws']) {
  assert.ok(Object.keys(await import('glocon/' + entry)).length);
  assert.ok(Object.keys(require('glocon/' + entry)).length);
}`;
    writeFileSync(join(cwd, "smoke.mjs"), smoke);
    execFileSync(manager === "bun" ? "bun" : process.execPath, ["smoke.mjs"], {
      cwd,
      stdio: "inherit",
    });
    console.log(
      `${manager}: clean install with scripts disabled, ESM/CommonJS, currency/time, metered invoice and exact credits passed`,
    );
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
