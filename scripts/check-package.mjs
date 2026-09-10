import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';

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
  assert.ok(packed.files.some(file => file.path === 'bin/glocon.mjs'));
  assert.ok(!packed.files.some(file => /(^|\/)(\.env|\.npmrc|node_modules)/.test(file.path)));
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temp, packed.filename)], { cwd: temp, stdio: 'pipe' });
  writeFileSync(join(temp, 'finance-browser.js'), `import {calculateOrder,createComplianceExample} from 'glocon/compliance'; const e=createComplianceExample('JP'); globalThis.gloconFinancialResult=calculateOrder(e.config,e.order);`);
  buildSync({entryPoints:[join(temp,'finance-browser.js')],bundle:true,platform:'browser',format:'iife',outfile:join(temp,'finance-bundle.js')});
  const installedCli = join(temp, 'node_modules/glocon/bin/glocon.mjs');
  assert.equal(execFileSync(process.execPath, [installedCli, '--version'], { encoding: 'utf8' }).trim(), manifest.version);
  execFileSync(process.execPath, [installedCli, 'init', '--country', 'IN', '--dir', temp, '--no-install'], { stdio: 'pipe' });
  const plan = JSON.parse(execFileSync(process.execPath, [installedCli, 'plan', '--dir', temp, '--json'], { encoding: 'utf8' }));
  assert.equal(plan.country, 'IN');
  assert.ok(plan.questions.length > 0);
  const smoke = `import assert from 'node:assert/strict';
import { createGlobalConfig } from 'glocon';
import { createRequire } from 'node:module';
import configured from './globalconfig.cjs';
const require = createRequire(import.meta.url);
assert.equal(configured.country.code, 'IN');
assert.equal(createGlobalConfig({ country: 'IN' }).currency.format('100'), '₹100.00');
assert.equal(require('glocon').getCountry('Japan').code, 'JP');
assert.equal(createGlobalConfig('IN').tax.calculate({ amount: '100', rate: '18', supply: 'inter-state' }).gross, '118.00');
assert.equal(require('glocon').createGlobalConfig('JP').currency.toMinorUnits('100'), 100n);
for (const entry of ['countries', 'currency', 'time', 'tax', 'laws', 'compliance']) {
  assert.ok(Object.keys(await import('glocon/' + entry)).length);
  assert.ok(Object.keys(require('glocon/' + entry)).length);
}`;
  writeFileSync(join(temp, 'smoke.mjs'), smoke);
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: temp, stdio: 'inherit' });
  const consumer = `import { createGlobalConfig, calculateTax, type LawTopic, type GlobalConfig, type GlobalConfigOptions, type CountryTaxOptions, type AppFact, type ReviewStatus } from 'glocon';
import configured from './globalconfig.cjs';
import { globalconfig as frontend } from './globalconfig.js';
configured.currency.format('100');
frontend.laws.plan();
const app = createGlobalConfig({ country: 'IN' });
const topic: LawTopic = 'privacy';
app.laws.list({ topic });
app.currency.convert({ amount: '10', to: 'JPY', rates: { base: 'USD', rates: { INR: '83', JPY: '150' }, asOf: '2026-01-01T00:00Z', source: 'fixture' } });
calculateTax({ country: 'JP', amount: 10, category: 'standard' });
// @ts-expect-error US taxes require jurisdiction and rate
calculateTax({ country: 'US', amount: 10 });
// @ts-expect-error unsupported currency
app.currency.convert({ amount: 10, to: 'EUR' });

const india: GlobalConfig<'IN'> = createGlobalConfig('IN');
const code: 'IN' = india.country.code;
const indiaTax: CountryTaxOptions<'IN'> = { amount: '100', rate: '18', supply: 'intra-state' };
india.tax.calculate(indiaTax);
india.tax.calculate({ ...indiaTax, country: 'IN' });
const minor: bigint = india.currency.toMinorUnits('10.25', 'half-even');
const major: string = india.currency.fromMinorUnits(minor);
// @ts-expect-error India still requires supply treatment
india.tax.calculate({ amount: '100', rate: '18' });
// @ts-expect-error India still requires an explicit rate
india.tax.calculate({ amount: '100', supply: 'intra-state' });
// @ts-expect-error Country-specific autocomplete rejects Japan fields on India
india.tax.calculate({ amount: '100', category: 'standard' });
// @ts-expect-error Explicit tax country must match the client
india.tax.calculate({ country: 'JP', amount: '100', category: 'standard' });

const usOptions: GlobalConfigOptions<'US'> = { country: 'US', timeZone: 'America/New_York' };
const us = createGlobalConfig(usOptions);
us.tax.calculate({ amount: '100', rate: '8', jurisdiction: 'Example district' });
// @ts-expect-error US still requires jurisdiction
us.tax.calculate({ amount: '100', rate: '8' });
// @ts-expect-error An India-shaped tax call must not be accepted on a US client
us.tax.calculate({ amount: '100', rate: '18', supply: 'intra-state' });

const japan = createGlobalConfig({ country: 'Japan' });
const japanCode: 'JP' = japan.country.code;
japan.tax.calculate({ amount: '1000', category: 'standard' });
japan.tax.calculate({ amount: '1000', rate: '8' });
// @ts-expect-error Japan requires a category or a rate
japan.tax.calculate({ amount: '1000' });
// @ts-expect-error Japan category and explicit rate are mutually exclusive
japan.tax.calculate({ amount: '1000', category: 'standard', rate: '8' });
const aliasCode: 'US' = createGlobalConfig('usa').country.code;
const runtimeCountry: string = 'IN';
createGlobalConfig(runtimeCountry).tax.calculate({ amount: '100', rate: '18', supply: 'intra-state' });
const configuredFacts = createGlobalConfig({ country: 'IN', facts: { collectsPersonalData: true } });
const plan = configuredFacts.laws.plan({ facts: { sellsTaxableItems: false } });
const fact: AppFact | undefined = plan.questions[0]?.fact;
const status: ReviewStatus | undefined = plan.tasks[0]?.status;
// @ts-expect-error Unknown facts must not silently affect applicability
configuredFacts.laws.plan({ facts: { madeUp: true } });
// @ts-expect-error Facts require boolean answers
createGlobalConfig({ country: 'IN', facts: { collectsPersonalData: 'yes' } });
`;
  for (const extension of ['mts', 'cts']) {
    const file = `consumer.${extension}`;
    writeFileSync(join(temp, file), consumer);
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file], { cwd: temp, stdio: 'inherit' });
  }
  const bundled = buildSync({
    entryPoints: [join(temp, 'globalconfig.js')], bundle: true, platform: 'browser', format: 'esm',
    outfile: join(temp, 'browser-bundle.mjs'), metafile: true, logLevel: 'silent',
  });
  assert.ok(Object.values(bundled.metafile.outputs).every(output => output.imports.length === 0), 'Frontend bundle must not require Node modules or external runtime imports');
  execFileSync(process.execPath, ['--input-type=module', '-e', "const {globalconfig} = await import('./browser-bundle.mjs'); if (globalconfig.currency.toMinorUnits('1.25') !== 125n) throw new Error('Frontend bundle failed');"], { cwd: temp, stdio: 'inherit' });
  const prefix = join(temp, 'global-install');
  execFileSync('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', join(temp, packed.filename)], { stdio: 'pipe' });
  const bin = process.platform === 'win32' ? join(prefix, 'glocon.cmd') : join(prefix, 'bin/glocon');
  assert.equal(execFileSync(bin, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim(), manifest.version);
  console.log(`Package verified: ${packed.filename} (${packed.size} bytes), isolated install, ESM/CJS, TypeScript consumers, generated frontend bundle, and global CLI.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
