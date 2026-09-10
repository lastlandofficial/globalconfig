import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { auditPage, auditStates, assertUI } from '../src/ui/playwright';
import { collectSnapshot } from '../src/ui/browser';
import { defineContract } from '../src/ui';
const exec = promisify(execFile);
test('finds accessibility and UX defects in a real rendered page', async ({ page }) => {
  await page.goto('/fixtures/broken.html');
  const report = await auditPage(page);
  const ids = report.findings.map(f => f.ruleId);
  expect(ids).toEqual(expect.arrayContaining(['axe/button-name', 'axe/html-has-lang', 'layout/overflow', 'interaction/target-size', 'form/error-description', 'form/placeholder-label', 'interaction/positive-tabindex', 'ux/busy-feedback']));
  expect(report.findings.some(f => f.target === '#hidden')).toBe(false);
  expect(() => assertUI(report)).toThrow('glocon');
});
test('healthy responsive controls pass at phone and desktop widths', async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/fixtures/healthy.html');
    const report = await auditPage(page);
    expect(report.findings, JSON.stringify(report.findings)).toEqual([]);
  }
});
test('preserves axe and custom suppressions and disabled rules', async ({ page }) => {
  await page.goto('/fixtures/broken.html');
  const report = await auditPage(page, { rules: { 'axe/html-has-lang': 'off' }, suppressions: [{ ruleId: 'axe/button-name', reason: 'Fixture exception' }, { ruleId: 'form/error-description', target: '#email', reason: 'Fixture exception' }] });
  expect(report.findings.some(f => ['axe/html-has-lang', 'axe/button-name', 'form/error-description'].includes(f.ruleId))).toBe(false);
  expect(report.suppressed.map(s => s.finding.ruleId)).toEqual(expect.arrayContaining(['axe/button-name', 'form/error-description']));
});
test('collects unique selectors, redacts values, and reports truncation', async ({ page }) => {
  await page.goto('/fixtures/healthy.html?token=private');
  await page.locator('#email').fill('private@example.com');
  await page.evaluate(() => { const button = document.createElement('button'); button.id = 'email'; button.textContent = 'Duplicate ID'; document.body.append(button); });
  const snapshot = await page.evaluate(collectSnapshot, {});
  expect(new Set(snapshot.elements.map(e => e.target)).size).toBe(snapshot.elements.length);
  expect(JSON.stringify(snapshot)).not.toContain('private@example.com');
  expect(snapshot.url).not.toContain('token=');
  const limited = await page.evaluate(collectSnapshot, { maxElements: 5 });
  expect(limited.limitations?.join(' ')).toContain('truncated');
});
test('state contracts verify visible requirements and mark missing scenarios', async ({ page }) => {
  await page.goto('/react');
  await expect(page.getByRole('heading', { name: 'No orders yet' })).toBeVisible();
  const contract = defineContract({ name: 'orders', states: {
    empty: { required: [{ selector: '[data-glocon-state="empty"] h2', description: 'empty explanation' }] },
    loading: { required: [{ selector: '[data-glocon-state="loading"] [role="status"]', description: 'loading feedback' }] },
    error: { required: [{ selector: '#retry', description: 'retry button' }] },
    success: { required: [{ selector: '[data-glocon-state="success"] li', description: 'order rows' }] },
  } });
  const report = await auditStates(page, contract, {
    empty: async () => {},
    loading: async p => { await p.getByRole('button', { name: 'Load orders' }).click(); await expect(p.getByText('Loading orders…')).toBeVisible(); },
    error: async p => { await p.getByRole('button', { name: 'Simulate failure' }).click(); await expect(p.locator('#retry')).toBeVisible(); },
  });
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0]).toMatchObject({ ruleId: 'contract/untested-state', target: 'orders/success' });
});
test('React controls keep focus, prevent repeat actions, and preserve form input', async ({ page }) => {
  await page.goto('/react');
  const field = page.getByRole('textbox', { name: 'Email address' });
  await field.fill('developer@example.com');
  await page.locator('#save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Actions: 1' })).toBeVisible();
  await expect(page.locator('#save')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(page.getByRole('status').filter({ hasText: 'Actions: 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Show field error' }).click();
  await expect(field).toHaveValue('developer@example.com');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription('Use your work email address. Enter a valid work email address.');
  expect((await auditPage(page)).findings).toEqual([]);
});
test('React controls pass in dark mode and narrow layouts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/react');
  await expect(page.locator('#save')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.gloconTheme = 'dark'; document.body.style.background = '#18181b'; document.body.style.color = '#fafafa'; });
  expect((await auditPage(page)).findings).toEqual([]);
});
test('published CLI produces JSON and meaningful exit codes', async () => {
  const ok = await exec(process.execPath, ['bin/glocon.mjs', 'audit', 'http://127.0.0.1:4179/fixtures/healthy.html', '--json']);
  expect(JSON.parse(ok.stdout).summary.total).toBe(0);
  try {
    await exec(process.execPath, ['bin/glocon.mjs', 'audit', 'http://127.0.0.1:4179/fixtures/broken.html', '--json']);
    throw new Error('Expected CLI failure');
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string };
    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout).summary.error).toBeGreaterThan(0);
  }
  await expect(exec(process.execPath, ['bin/glocon.mjs', 'audit', 'file:///tmp/example.html'])).rejects.toMatchObject({ code: 2 });
});

test('financial calculation, invoice and partial credit core runs in the browser', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/finance');
  await expect(page.locator('#result')).toHaveText(JSON.stringify({gross:'2200',credit:'1100'}));
  expect(errors).toEqual([]);
});
