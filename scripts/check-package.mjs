import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const entry of Object.values(manifest.exports)) {
  if (typeof entry === 'string') { assert.ok(existsSync(join(root, entry))); continue; }
  for (const target of Object.values(entry)) for (const file of Object.values(target)) assert.ok(existsSync(join(root, file)), `Missing export: ${file}`);
}
const temp = mkdtempSync(join(tmpdir(), 'globalconfig-package-'));
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }))[0];
  assert.ok(packed.files.some(file => file.path === 'LICENSE'));
  assert.ok(!packed.files.some(file => /(^|\/)(\.env|\.npmrc|node_modules)/.test(file.path)));
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temp, packed.filename)], { cwd: temp, stdio: 'pipe' });
  const smoke = `import assert from 'node:assert/strict';
import { createGlobalConfig } from 'globalconfig';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
assert.equal(createGlobalConfig({ country: 'IN' }).currency.format('100'), '₹100.00');
assert.equal(require('globalconfig').getCountry('Japan').code, 'JP');
for (const entry of ['countries', 'currency', 'time', 'tax', 'laws']) {
  assert.ok(Object.keys(await import('globalconfig/' + entry)).length);
  assert.ok(Object.keys(require('globalconfig/' + entry)).length);
}`;
  writeFileSync(join(temp, 'smoke.mjs'), smoke);
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: temp, stdio: 'inherit' });
  const consumer = `import { createGlobalConfig, calculateTax, type LawTopic } from 'globalconfig';
const app = createGlobalConfig({ country: 'IN' });
const topic: LawTopic = 'privacy';
app.laws.list({ topic });
app.currency.convert({ amount: '10', to: 'JPY', rates: { base: 'USD', rates: { INR: '83', JPY: '150' }, asOf: '2026-01-01T00:00Z', source: 'fixture' } });
calculateTax({ country: 'JP', amount: 10, category: 'standard' });
// @ts-expect-error US taxes require jurisdiction and rate
calculateTax({ country: 'US', amount: 10 });
// @ts-expect-error unsupported currency
app.currency.convert({ amount: 10, to: 'EUR' });
`;
  for (const extension of ['mts', 'cts']) {
    const file = `consumer.${extension}`;
    writeFileSync(join(temp, file), consumer);
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file], { cwd: temp, stdio: 'inherit' });
  }
  console.log(`Package verified: ${packed.filename} (${packed.size} bytes), isolated install, ESM/CJS, and both TypeScript declaration formats.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
