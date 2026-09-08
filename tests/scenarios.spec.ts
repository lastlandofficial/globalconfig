import { test, expect } from '@playwright/test';
import { mkdtemp, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runChecks, saveBaseline, type CheckConfig, type CheckScenario, type CheckStep } from '../src/check';
const enter: CheckStep[] = [{ action: 'expect', selector: '#name', value: '' }, { action: 'fill', selector: '#name', value: 'private-fixture-value' }, { action: 'click', selector: '#save' }];
const mock = (responses: NonNullable<CheckScenario['mocks']>[number]['responses']) => [{ path: '/api/projects', method: 'POST' as const, responses }];
const failure = { status: 503, json: { message: 'Unavailable' } };
const success = { json: { message: 'Saved' } };
async function fixture(scenarios: CheckScenario[]) {
  const dir = await mkdtemp(join(tmpdir(), 'glocon-scenarios-'));
  await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
  const config: CheckConfig = { version: 1, baseURL: 'http://127.0.0.1:4179', pages: [{ path: '/fixtures/scenarios.html', scenarios }], viewports: [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }], audit: { timeout: 1500 }, screenshots: false, failOn: 'none' };
  return { dir, config };
}
test('loading, error, retry, and success audit isolated final states with retained input and focus', async ({ page }) => {
  test.setTimeout(60000);
  const { dir, config } = await fixture([
    { name: 'loading', mocks: mock([{ pending: true }]), steps: [...enter, { action: 'expect', selector: '#status', text: 'Saving…' }, { action: 'expect', selector: '#save', state: 'disabled' }] },
    { name: 'error', mocks: mock([failure]), steps: [...enter, { action: 'expect', selector: '#retry', state: 'focused' }, { action: 'expect', selector: '#name', value: 'private-fixture-value' }] },
    { name: 'retry', mocks: mock([failure, success]), steps: [...enter, { action: 'expect', selector: '#retry', state: 'visible' }, { action: 'click', selector: '#retry' }, { action: 'expect', selector: '#status', text: 'Saved' }, { action: 'expect', selector: '#name', value: 'private-fixture-value' }, { action: 'expect', selector: '#retry', state: 'hidden' }] },
    { name: 'success', mocks: mock([success]), steps: [...enter.slice(0, 2), { action: 'press', selector: '#name', key: 'Enter' }, { action: 'expect', selector: '#status', text: 'Saved' }, { action: 'expect', selector: '#save', state: 'enabled' }] },
  ]);
  try {
    const report = await runChecks(config, { dir });
    expect(report.summary.incomplete, JSON.stringify(report.cases.map(c => c.message))).toBe(0);
    expect(report.cases).toHaveLength(8);
    for (const result of report.cases) { expect(result.steps?.every(step => step.status === 'passed')).toBe(true); expect(result.mocks?.[0]?.calls).toBe(result.scenario === 'retry' ? 2 : 1); }
    expect(JSON.stringify(report)).not.toContain('private-fixture-value');
    await page.goto(`file://${join(dir, '.glocon/report.html')}`);
    await page.getByText('Scenario steps', { exact: true }).first().click();
    await expect(page.getByText('POST /api/projects: 1 request(s), 1 response(s) required').first()).toBeVisible();
    await expect(saveBaseline(dir, config, 'Reviewed fixture states')).resolves.toBeGreaterThanOrEqual(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('failed expectations and unused mock responses are incomplete, cannot be baselined, and omit assertion values', async () => {
  const { dir, config } = await fixture([
    { name: 'wrong state', steps: [{ action: 'expect', selector: '#name', value: 'secret-expectation' }, { action: 'click', selector: '#save' }] },
    { name: 'unused mock', steps: [], mocks: mock([success]) },
    { name: 'missing retry', steps: [...enter, { action: 'expect', selector: '#retry', state: 'visible' }], mocks: mock([failure, success]) },
  ]);
  config.viewports = [config.viewports[0]!];
  try {
    const report = await runChecks(config, { dir });
    expect(report.exitCode).toBe(2); expect(report.summary.incomplete).toBe(3);
    expect(report.cases[0]!.steps?.map(s => s.status)).toEqual(['failed', 'not-run']);
    expect(JSON.stringify(report)).not.toContain('secret-expectation');
    expect(report.cases[1]!.message).toContain('consume every');
    expect(report.cases[2]!.mocks?.[0]?.calls).toBe(1);
    await expect(saveBaseline(dir, config, 'Cannot accept')).rejects.toThrow('every configured');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('a UI defect reached only after interaction fails and produces a highlighted screenshot', async () => {
  const { dir, config } = await fixture([{ name: 'saved result', mocks: mock([{ json: { message: 'Saved', broken: true } }]), steps: [...enter, { action: 'expect', selector: '#broken-result', state: 'visible' }] }]);
  config.failOn = 'error'; config.screenshots = true; config.viewports = [config.viewports[0]!];
  try {
    const report = await runChecks(config, { dir });
    expect(report.exitCode).toBe(1); expect(report.summary.completed).toBe(1);
    expect(report.issues.some(issue => issue.target.includes('broken-result'))).toBe(true);
    expect((await readFile(join(dir, '.glocon', report.cases[0]!.screenshot!))).length).toBeGreaterThan(100);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('interrupting a pending request and expectation closes the context without hanging', async () => {
  test.setTimeout(15000);
  const { dir, config } = await fixture([{ name: 'pending', mocks: mock([{ pending: true }]), steps: [...enter, { action: 'expect', selector: '#status', text: 'Will never arrive' }] }]);
  config.viewports = [config.viewports[0]!]; config.audit = { timeout: 30000 };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const report = await runChecks(config, { dir, signal: controller.signal });
    expect(report.exitCode).toBe(2); expect(report.summary.incomplete).toBe(1);
    expect(report.cases[0]!.message).toBe('Run interrupted.');
    expect((await fetch(config.baseURL)).ok).toBe(true);
  } finally { clearTimeout(timer); await rm(dir, { recursive: true, force: true }); }
});
