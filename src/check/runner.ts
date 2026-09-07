import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Page } from 'playwright';
import { auditPage } from '../ui/playwright/index';
import { ensureServer, runCommand } from './process';
import { resolvePlaywright } from './setup';
import { pageURL, validateCheckConfig, type CheckConfig } from './config';
import { makeReport, readBaseline, writeJSON, renderCheckReport, caseId, type CheckCase, type CheckReport, type Baseline } from './report';

class AuthRequired extends Error {}
const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/[^\s"'<>]+/g, value => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return '[URL]'; } });
function signalScope(external?: AbortSignal) {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Run interrupted.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  external?.addEventListener('abort', stop, { once: true });
  if (external?.aborted) stop();
  return { signal: controller.signal, dispose() { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); external?.removeEventListener('abort', stop); } };
}
async function capture(page: Page, targets: string[], file: string) {
  await page.evaluate(selectors => {
    for (const target of selectors) {
      let selector = target;
      try { const parsed: unknown = JSON.parse(target); if (Array.isArray(parsed)) { if (parsed.length !== 1 || typeof parsed[0] !== 'string') continue; selector = parsed[0]; } } catch {}
      try {
        for (const element of document.querySelectorAll(selector)) {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const marker = document.createElement('div');
          marker.setAttribute('data-glocon-highlight', '');
          Object.assign(marker.style, { position: 'absolute', left: `${rect.left + scrollX}px`, top: `${rect.top + scrollY}px`, width: `${rect.width}px`, height: `${rect.height}px`, outline: '3px solid #dc2626', outlineOffset: '-3px', pointerEvents: 'none', zIndex: '2147483647', boxSizing: 'border-box' });
          document.documentElement.append(marker);
        }
      } catch {}
    }
  }, targets);
  try { await page.screenshot({ path: file, timeout: 10000, animations: 'disabled', mask: [page.locator('input, textarea, [contenteditable="true"]')] }); }
  finally { await page.evaluate(() => { document.querySelectorAll('[data-glocon-highlight]').forEach(e => e.remove()); }).catch(() => {}); }
}
async function timed<T>(task: Promise<T>, ms: number, signal: AbortSignal, cancel: () => Promise<unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      const fail = (error: Error) => { reject(error); void cancel().catch(() => {}); };
      timer = setTimeout(() => fail(new Error('Page check timed out. Set audit.timeout or a page readySelector for slow apps.')), ms);
      abort = () => fail(new Error('Run interrupted.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export interface RunCheckOptions { dir?: string; signal?: AbortSignal }
export async function runChecks(config: CheckConfig, options: RunCheckOptions = {}): Promise<CheckReport> {
  config = validateCheckConfig(config);
  const dir = resolve(options.dir ?? '.');
  const scope = signalScope(options.signal);
  const cases: CheckCase[] = [];
  const pages = config.pages.map(p => typeof p === 'string' ? { path: p } : p);
  for (const page of pages) for (const viewport of config.viewports) cases.push({ id: caseId(page.path, viewport, page.auth ?? false), page: pageURL(page.path, config.baseURL).pathname, name: page.name ?? pageURL(page.path, config.baseURL).pathname, viewport, status: 'error', message: 'Not run.' });
  const output = resolve(dir, '.glocon');
  let baseline: Baseline = { version: 1, entries: [] };
  let stopServer: () => Promise<void> = async () => {};
  let browser: Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>> | undefined;
  const closeBrowser = () => { void browser?.close().catch(() => {}); };
  scope.signal.addEventListener('abort', closeBrowser, { once: true });
  try {
    await mkdir(resolve(output, 'screenshots'), { recursive: true });
    // Invalidate a previous complete run before any startup or auth work can fail.
    await writeJSON(resolve(output, 'report.json'), makeReport(config, cases, baseline));
    baseline = await readBaseline(dir);
    const playwright = resolvePlaywright(dir);
    stopServer = await ensureServer(config, dir, scope.signal);
    let authError: string | undefined;
    if (config.auth && pages.some(p => p.auth)) {
      try {
        if (config.auth.setupCommand) await runCommand(config.auth.setupCommand, dir, scope.signal);
        const state = JSON.parse(await readFile(resolve(dir, config.auth.storageState), 'utf8'));
        if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('Invalid storage state');
      } catch { authError = 'Test login is unavailable. Run glocon login or fix auth.setupCommand and auth.storageState.'; }
    }
    scope.signal.throwIfAborted();
    browser = await playwright.chromium.launch();
    let index = 0;
    for (const entry of pages) for (const viewport of config.viewports) {
      const result = cases[index++]!;
      if (scope.signal.aborted) { result.message = 'Run interrupted.'; continue; }
      if (entry.auth && authError) { result.status = 'auth-required'; result.message = authError; continue; }
      const timeout = config.audit?.timeout ?? 30000;
      let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
      try {
        context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: viewport.colorScheme ?? 'light', ...(entry.auth && config.auth ? { storageState: resolve(dir, config.auth.storageState) } : {}) });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        const check = async () => {
          const requested = pageURL(entry.path, config.baseURL);
          const response = await page.goto(requested.href, { waitUntil: 'domcontentloaded', timeout });
          if (entry.auth && (response?.status() === 401 || response?.status() === 403)) throw new AuthRequired('Test session was rejected. Refresh it with glocon login or your auth setup command.');
          if (entry.auth && config.auth) {
            const loginPath = pageURL(config.auth.loginPath ?? '/login', config.baseURL).pathname;
            if (new URL(page.url()).pathname === loginPath && requested.pathname !== loginPath) throw new AuthRequired('Redirected to login. Refresh the test session.');
            try { await page.locator(config.auth.readySelector).waitFor({ state: 'visible', timeout }); }
            catch { throw new AuthRequired('The authenticated-page marker was not visible. Refresh the session or check auth.readySelector.'); }
          }
          if (response && !response.ok()) throw new Error(`Page returned HTTP ${response.status()}.`);
          const final = new URL(page.url());
          if (final.origin !== requested.origin || final.pathname.replace(/\/$/, '') !== requested.pathname.replace(/\/$/, '')) throw new Error('Page redirected to a different route. Configure the destination explicitly so the intended page is checked.');
          const report = await auditPage(page, { ...config.audit, ...(entry.readySelector ? { readySelector: entry.readySelector } : {}) });
          if (config.screenshots !== false && report.findings.length) {
            const filename = `screenshots/${result.id}.png`;
            try { await capture(page, report.findings.map(f => f.target), resolve(output, filename)); result.screenshot = filename; }
            catch { report.coverage.limitations.push('Highlighted screenshot could not be captured for this page.'); }
            report.coverage.limitations.push('Screenshots show the current viewport with available light-DOM targets highlighted. Offscreen, iframe, and shadow-root targets may not be highlighted; form inputs are masked.');
          }
          return report;
        };
        result.report = await timed(check(), timeout * 3 + 10000, scope.signal, () => context!.close());
        result.status = 'completed'; delete result.message;
      } catch (error) { result.status = error instanceof AuthRequired ? 'auth-required' : 'error'; result.message = safeError(error); }
      finally { await context?.close().catch(() => {}); }
    }
  } catch (error) {
    for (const result of cases) if (result.message === 'Not run.') result.message = safeError(error);
  } finally {
    scope.signal.removeEventListener('abort', closeBrowser);
    await browser?.close().catch(() => {});
    await stopServer(); scope.dispose();
  }
  const report = makeReport(config, cases, baseline);
  await writeJSON(resolve(output, 'report.json'), report);
  await writeFile(resolve(output, 'report.html'), renderCheckReport(report), { mode: 0o600 });
  return report;
}
/** Interactive test-session capture. Existing Playwright storageState files work without this command. */
export async function login(config: CheckConfig, dir: string) {
  if (!config.auth) throw new Error('Add auth.storageState, auth.readySelector, and auth.loginPath to glocon.check.json first.');
  if (!process.stdin.isTTY) throw new Error('glocon login needs an interactive terminal and display. In CI use auth.setupCommand or an existing test storageState.');
  const scope = signalScope();
  let stopServer: () => Promise<void> = async () => {};
  let browser: Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>> | undefined;
  const close = () => { void browser?.close().catch(() => {}); };
  scope.signal.addEventListener('abort', close, { once: true });
  try {
    stopServer = await ensureServer(config, dir, scope.signal);
    browser = await resolvePlaywright(dir).chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(pageURL(config.auth.loginPath ?? '/login', config.baseURL).href);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { await prompt.question('Log in with a test account in the browser, then press Enter to save the session: ', { signal: scope.signal }); }
    finally { prompt.close(); }
    if (new URL(page.url()).origin !== new URL(config.baseURL).origin) throw new Error('Complete login and return to the configured app before saving the session.');
    await page.locator(config.auth.readySelector).waitFor({ state: 'visible', timeout: 10000 });
    const file = resolve(dir, config.auth.storageState);
    await mkdir(dirname(file), { recursive: true });
    await writeJSON(file, await context.storageState()); await chmod(file, 0o600);
    console.log('Saved the test session. Run glocon check. Keep the session file out of version control.');
  } finally { scope.signal.removeEventListener('abort', close); await browser?.close().catch(() => {}); await stopServer(); scope.dispose(); }
}
