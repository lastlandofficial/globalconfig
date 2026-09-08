import type { BrowserContext, Page } from 'playwright';

export type CheckStep =
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'press'; selector: string; key: string }
  | { action: 'expect'; selector: string; state: 'visible' | 'hidden' | 'enabled' | 'disabled' | 'focused' }
  | { action: 'expect'; selector: string; text: string }
  | { action: 'expect'; selector: string; value: string };
export type MockResponse = { pending: true } | { status?: number; json?: unknown };
export interface CheckMock { path: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'; responses: MockResponse[] }
export interface CheckScenario { name: string; steps: CheckStep[]; mocks?: CheckMock[]; readySelector?: string }
export interface StepResult { action: CheckStep['action']; selector: string; status: 'not-run' | 'passed' | 'failed' }
export interface MockResult { path: string; method: string; calls: number; expectedResponses: number }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function fields(v: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(v)) if (!allowed.includes(key)) throw new Error(`Scenario: unknown option ${key}.`);
}
function nonempty(v: unknown): v is string { return typeof v === 'string' && !!v.trim(); }
function jsonValue(v: unknown, seen = new Set<unknown>()): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (!object(v) && !Array.isArray(v)) return false;
  if (seen.has(v)) return false;
  if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
  seen.add(v);
  const valid = Object.values(v).every(item => jsonValue(item, seen));
  seen.delete(v); return valid;
}
export function validateScenarios(value: unknown): asserts value is CheckScenario[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('Configure 1–20 scenarios per page.');
  const names = new Set<string>();
  for (const scenario of value) {
    if (!object(scenario)) throw new Error('Each scenario must be an object.');
    fields(scenario, ['name', 'steps', 'mocks', 'readySelector']);
    if (!nonempty(scenario.name) || names.has(scenario.name)) throw new Error('Scenario names must be non-empty and unique per page.');
    names.add(scenario.name);
    if (scenario.readySelector !== undefined && !nonempty(scenario.readySelector)) throw new Error('Scenario readySelector must be non-empty.');
    if (!Array.isArray(scenario.steps) || scenario.steps.length > 50) throw new Error('Scenario steps must be an array with at most 50 actions.');
    for (const step of scenario.steps) {
      if (!object(step) || !nonempty(step.selector)) throw new Error('Every step needs a selector.');
      if (step.action === 'click') fields(step, ['action', 'selector']);
      else if (step.action === 'fill') { fields(step, ['action', 'selector', 'value']); if (typeof step.value !== 'string') throw new Error('fill needs a string value.'); }
      else if (step.action === 'press') { fields(step, ['action', 'selector', 'key']); if (!nonempty(step.key)) throw new Error('press needs a key.'); }
      else if (step.action === 'expect') {
        fields(step, ['action', 'selector', 'state', 'text', 'value']);
        if (['state', 'text', 'value'].filter(key => key in step).length !== 1) throw new Error('expect needs exactly one of state, text, or value.');
        if ('state' in step && !['visible', 'hidden', 'enabled', 'disabled', 'focused'].includes(String(step.state))) throw new Error('Invalid expected state.');
        for (const key of ['text', 'value']) if (key in step && typeof step[key] !== 'string') throw new Error(`Expected ${key} must be a string.`);
      } else throw new Error('Step action must be click, fill, press, or expect.');
    }
    if (scenario.mocks !== undefined) {
      if (!Array.isArray(scenario.mocks) || scenario.mocks.length > 20) throw new Error('Configure at most 20 mocks per scenario.');
      const routes = new Set<string>();
      for (const mock of scenario.mocks) {
        if (!object(mock)) throw new Error('Each mock must be an object.');
        fields(mock, ['path', 'method', 'responses']);
        if (!nonempty(mock.path) || !mock.path.startsWith('/') || mock.path.startsWith('//') || /[\\?#]/.test(mock.path) || new URL(mock.path, 'http://glocon.test').pathname !== mock.path) throw new Error('Mock path must be an exact URL pathname starting with /, without query or fragment.');
        if (mock.method !== undefined && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(String(mock.method))) throw new Error('Invalid mock method.');
        const key = `${mock.method ?? 'GET'} ${mock.path}`;
        if (routes.has(key)) throw new Error('Duplicate mock path and method.');
        routes.add(key);
        if (!Array.isArray(mock.responses) || !mock.responses.length || mock.responses.length > 20) throw new Error('Each mock needs 1–20 responses.');
        for (const response of mock.responses) {
          if (!object(response)) throw new Error('Mock response must be an object.');
          if ('pending' in response) { fields(response, ['pending']); if (response.pending !== true) throw new Error('pending must be true.'); }
          else {
            fields(response, ['status', 'json']);
            if (response.status !== undefined && (typeof response.status !== 'number' || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 || (response.status >= 300 && response.status < 400))) throw new Error('Mock status must be 200–299 or 400–599.');
            if ('json' in response && (!jsonValue(response.json) || [204, 205].includes(Number(response.status)) || mock.method === 'HEAD')) throw new Error('Mock json must be JSON-serializable and use a status/method that permits a body.');
          }
        }
      }
    }
  }
}
/** Exact, same-origin fetch/XHR mocks. Responses are consumed in order; the last repeats. */
export async function installMocks(context: BrowserContext, scenario: CheckScenario, baseURL: string): Promise<MockResult[]> {
  const mocks = scenario.mocks ?? [];
  const results = mocks.map(mock => ({ path: mock.path, method: mock.method ?? 'GET', calls: 0, expectedResponses: mock.responses.length }));
  if (!mocks.length) return results;
  const origin = new URL(baseURL).origin;
  const closed = new Promise<void>(resolve => context.once('close', () => resolve()));
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    const index = mocks.findIndex((mock, i) => url.origin === origin && url.pathname === mock.path && request.method() === results[i]!.method && ['xhr', 'fetch'].includes(request.resourceType()));
    if (index < 0) { await route.continue(); return; }
    const mock = mocks[index]!; const result = results[index]!;
    const response = mock.responses[Math.min(result.calls++, mock.responses.length - 1)]!;
    if ('pending' in response) {
      // Keep pending handlers alive until their isolated context closes.
      await closed;
      return;
    }
    await route.fulfill({ status: response.status ?? 200, ...('json' in response ? { json: response.json } : { body: '' }) });
  });
  return results;
}
async function assertStep(page: Page, step: Extract<CheckStep, { action: 'expect' }>, timeout: number) {
  const locator = page.locator(step.selector); const deadline = Date.now() + timeout;
  while (true) {
    const count = await locator.count();
    if (count > 1) throw new Error('Expectation selector must match at most one element.');
    let passed = false;
    if ('state' in step) {
      if (step.state === 'hidden') passed = count === 0 || !(await locator.isVisible());
      else if (count === 1) {
        if (step.state === 'visible') passed = await locator.isVisible();
        else if (step.state === 'enabled') passed = await locator.isEnabled();
        else if (step.state === 'disabled') passed = await locator.isDisabled();
        else passed = await locator.evaluate(element => element === element.ownerDocument.activeElement);
      }
    } else if (count === 1) {
      passed = 'text' in step ? (await locator.innerText()) === step.text : (await locator.inputValue()) === step.value;
    }
    if (passed) return;
    if (Date.now() >= deadline || page.isClosed()) throw new Error('Expectation was not met.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
export async function runSteps(page: Page, scenario: CheckScenario, results: StepResult[], timeout: number) {
  for (const [index, step] of scenario.steps.entries()) {
    try {
      if (step.action === 'expect') await assertStep(page, step, timeout);
      else if (step.action === 'click') await page.locator(step.selector).click({ timeout });
      else if (step.action === 'fill') await page.locator(step.selector).fill(step.value, { timeout });
      else await page.locator(step.selector).press(step.key, { timeout });
      results[index]!.status = 'passed';
    } catch {
      results[index]!.status = 'failed';
      // Playwright errors include input values and DOM text: keep them out of scenario diagnostics.
      throw new Error(`Scenario step ${index + 1} (${step.action}) failed. Check the selector and expected state in glocon.check.json.`);
    }
  }
}
