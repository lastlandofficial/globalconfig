import type { CheckPage } from './config';
import type { CheckScenario, CheckStep, MockResponse } from './scenarios';
/** Copy this page into glocon.check.json and replace its route, selectors, and API payloads. */
export function scenarioExample(): CheckPage {
  const enter: CheckStep[] = [{ action: 'fill', selector: '#name', value: 'Launch' }, { action: 'click', selector: '#save' }];
  const error: MockResponse = { status: 503, json: { message: 'Unavailable' } };
  const success: MockResponse = { json: { message: 'Saved' } };
  const scenario = (name: string, responses: MockResponse[], steps: CheckStep[]): CheckScenario => ({ name, mocks: [{ path: '/api/projects', method: 'POST', responses }], steps: [...enter, ...steps] });
  return { path: '/', scenarios: [
    scenario('loading', [{ pending: true }], [{ action: 'expect', selector: '#save', state: 'disabled' }, { action: 'expect', selector: '#status', text: 'Saving…' }]),
    scenario('error', [error], [{ action: 'expect', selector: '#retry', state: 'visible' }, { action: 'expect', selector: '#name', value: 'Launch' }]),
    scenario('retry', [error, success], [{ action: 'expect', selector: '#retry', state: 'visible' }, { action: 'click', selector: '#retry' }, { action: 'expect', selector: '#status', text: 'Saved' }, { action: 'expect', selector: '#name', value: 'Launch' }]),
    scenario('success', [success], [{ action: 'expect', selector: '#status', text: 'Saved' }, { action: 'expect', selector: '#save', state: 'enabled' }]),
  ] };
}
