import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PageAuditOptions } from '../playwright/index';
import { rules } from '../core/engine';
import { formatReport, shouldFail } from '../core/report';
import type { Severity } from '../core/types';

const help = `glocon UI — Explainable UI and UX checks

  glocon audit <url> [options]     Audit a running app
  glocon ui init                      Write glocon.ui.json (never overwrites)
  glocon doctor [directory]        Detect frameworks and explain integration
  glocon rules [--json]            List built-in custom checks

Audit options:
  --config <path>       JSON config (defaults to glocon.ui.json when present)
  --json                Machine-readable report on stdout
  --output <path>       Write the report to a file
  --viewport <WxH>      Viewport in CSS pixels (default 1280x800)
  --ready <selector>    Wait for an app-specific visible readiness marker
  --timeout <ms>        Navigation/readiness timeout (default 30000)
  --fail-on <level>     error | warning | info | none (default error)
  --no-a11y             Skip axe accessibility checks

Exit codes: 0 passed, 1 findings at threshold, 2 invalid input/runtime failure.
Install a browser once: npx playwright install chromium
`;
interface Config extends PageAuditOptions { viewport?: { width: number; height: number }; failOn?: Severity | 'none' }
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function validateConfig(value: unknown): Config {
  if (!isRecord(value)) throw new Error('Config must be a JSON object.');
  const known = ['rules', 'spacingScale', 'spacingTolerance', 'targetSize', 'suppressions', 'accessibility', 'readySelector', 'timeout', 'maxElements', 'viewport', 'failOn'];
  for (const key of Object.keys(value)) if (!known.includes(key)) throw new Error(`Unknown config option: ${key}`);
  if (value.rules !== undefined && (!isRecord(value.rules) || Object.values(value.rules).some(level => !['error', 'warning', 'info', 'off'].includes(String(level))))) throw new Error('rules must map rule IDs to error, warning, info, or off.');
  if (value.spacingScale !== undefined && (!Array.isArray(value.spacingScale) || value.spacingScale.some(n => typeof n !== 'number' || n < 0))) throw new Error('spacingScale must be an array of non-negative numbers.');
  for (const key of ['targetSize', 'timeout', 'maxElements']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || Number(value[key]) <= 0)) throw new Error(`${key} must be a positive number.`);
  if (value.spacingTolerance !== undefined && (typeof value.spacingTolerance !== 'number' || value.spacingTolerance < 0)) throw new Error('spacingTolerance must be non-negative.');
  if (value.accessibility !== undefined && typeof value.accessibility !== 'boolean') throw new Error('accessibility must be a boolean.');
  if (value.readySelector !== undefined && typeof value.readySelector !== 'string') throw new Error('readySelector must be a string.');
  if (value.suppressions !== undefined && (!Array.isArray(value.suppressions) || value.suppressions.some(s => !isRecord(s) || typeof s.ruleId !== 'string' || typeof s.reason !== 'string' || !s.reason.trim() || (s.target !== undefined && typeof s.target !== 'string')))) throw new Error('suppressions need a ruleId, optional target, and non-empty reason.');
  if (value.viewport !== undefined && (!isRecord(value.viewport) || ![value.viewport.width, value.viewport.height].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 16384))) throw new Error('viewport width and height must be integers from 1 to 16384.');
  if (value.failOn !== undefined && !['error', 'warning', 'info', 'none'].includes(String(value.failOn))) throw new Error('Invalid failOn threshold.');
  return value as Config;
}
export async function runUICommand(args: string[], version: string) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' }, output: { type: 'string' }, config: { type: 'string' },
    viewport: { type: 'string' }, ready: { type: 'string' }, timeout: { type: 'string' }, 'fail-on': { type: 'string' }, 'no-a11y': { type: 'boolean' },
  } });
  if (values.version) { console.log(version); return; }
  if (values.help || !positionals.length) { console.log(help); return; }
  const command = positionals[0];
  if (command === 'rules') {
    console.log(values.json ? JSON.stringify(rules.map(rule => rule.meta), null, 2) : rules.map(rule => `${rule.meta.id.padEnd(32)} ${rule.meta.severity.padEnd(8)} ${rule.meta.title}`).join('\n'));
    return;
  }
  if (command === 'init') {
    await writeFile('glocon.ui.json', JSON.stringify({ viewport: { width: 1280, height: 800 }, failOn: 'error', accessibility: true, rules: {}, suppressions: [] }, null, 2) + '\n', { flag: 'wx' });
    console.log('Created glocon.ui.json. Start your app, then run: glocon audit http://localhost:3000');
    return;
  }
  if (command === 'doctor') {
    const directory = resolve(positionals[1] ?? '.');
    const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const frameworks: Array<[string, string]> = [['next', 'Next.js'], ['@tanstack/react-start', 'TanStack Start'], ['@angular/core', 'Angular'], ['react-native', 'React Native'], ['expo', 'Expo'], ['electron', 'Electron'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@sveltejs/kit', 'SvelteKit'], ['astro', 'Astro']];
    const detected = frameworks.filter(([name]) => deps[name]).map(([, name]) => name);
    const result = { directory, frameworks: detected.length ? detected : ['Node.js / generic JS'], integrations: ['Run glocon audit against an HTTP(S) app.', 'Use glocon/playwright in browser tests and glocon for pure snapshot/state checks.', ...(deps.react ? ['Import optional components from glocon/react and styles from glocon/styles.css.'] : []), ...(deps['react-native'] ? ['Native support currently requires measured nodes passed to glocon/native. It does not launch a device.'] : [])] };
    console.log(values.json ? JSON.stringify(result, null, 2) : `${result.frameworks.join(', ')}\n${result.integrations.join('\n')}`);
    return;
  }
  if (command !== 'audit') throw new Error(`Unknown command: ${command}. Run glocon --help.`);
  if (!positionals[1] || positionals.length > 2) throw new Error('Provide one URL: glocon audit http://localhost:3000');
  const url = new URL(positionals[1]);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Audit URL must use http: or https:.');
  let config: Config = {};
  try { config = validateConfig(JSON.parse(await readFile(values.config ?? 'glocon.ui.json', 'utf8'))); }
  catch (error) { if (values.config || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const threshold = values['fail-on'] ?? config.failOn ?? 'error';
  if (!['error', 'warning', 'info', 'none'].includes(threshold)) throw new Error('--fail-on must be error, warning, info, or none.');
  let viewport = config.viewport ?? { width: 1280, height: 800 };
  if (values.viewport) {
    const match = /^(\d+)x(\d+)$/.exec(values.viewport);
    if (!match) throw new Error('--viewport must look like 390x844.');
    viewport = { width: Number(match[1]), height: Number(match[2]) };
    validateConfig({ viewport });
  }
  const timeout = values.timeout !== undefined ? Number(values.timeout) : config.timeout ?? 30000;
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error('--timeout must be a positive integer in milliseconds.');
  let playwright: typeof import('playwright');
  try { playwright = await import('playwright'); } catch { throw new Error('Install the optional browser runner: npm install -D playwright && npx playwright install chromium'); }
  const { auditPage } = await import('../playwright/index');
  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout });
    if (response && !response.ok()) throw new Error(`Page returned HTTP ${response.status()}. Audit your intended page, not an error response.`);
    const report = await auditPage(page, { ...config, timeout, ...(values['no-a11y'] ? { accessibility: false } : {}), ...(values.ready !== undefined ? { readySelector: values.ready } : {}) });
    const output = values.json ? JSON.stringify(report, null, 2) : formatReport(report);
    if (values.output) await writeFile(values.output, output + '\n');
    else console.log(output);
    if (shouldFail(report, threshold as Severity | 'none')) process.exitCode = 1;
  } finally { await browser.close(); }
}
