import { describe, expect, it } from 'vitest';
import { validateCheckConfig, type CheckScenario } from '../src/check';
import { caseId, hash } from '../src/check/report';
const viewport = { name: 'phone', width: 390, height: 844 };
const config = (scenarios: unknown) => ({ version: 1, baseURL: 'http://localhost:3000', pages: [{ path: '/', scenarios }], viewports: [viewport] });
describe('scenario configuration', () => {
  it('rejects ambiguous steps and invalid mock definitions before starting an app', () => {
    const invalid = [
      [], [{ name: 'a', steps: [] }, { name: 'a', steps: [] }],
      [{ name: 'a', steps: [{ action: 'expect', selector: '#x', text: 'x', state: 'visible' }] }],
      [{ name: 'a', steps: [{ action: 'expect', selector: '#x', state: 'loaded' }] }],
      [{ name: 'a', steps: [{ action: 'fill', selector: '#x' }] }],
      [{ name: 'a', steps: [{ action: 'click', selector: '#x', force: true }] }],
      ...['https://example.com/api', '//example.com/api', '/api?query=1', '/api/../other'].map(path => [{ name: 'a', steps: [], mocks: [{ path, responses: [{}] }] }]),
      ...[{ status: 302 }, { status: 204, json: {} }, { json: undefined }, { json: NaN }, { json: new Date() }, { pending: true, status: 200 }].map(response => [{ name: 'a', steps: [], mocks: [{ path: '/api', responses: [response] }] }]),
    ];
    for (const scenarios of invalid) expect(() => validateCheckConfig(config(scenarios))).toThrow();
    expect(validateCheckConfig(config([{ name: 'default', steps: [] }])).pages).toHaveLength(1);
  });
  it('preserves plain 0.4 case identities and invalidates baselines when scenario behavior changes', () => {
    expect(caseId('/', viewport, false)).toBe(hash(['/', 'phone', 390, 844, 'light', false]));
    const scenario: CheckScenario = { name: 'saved', steps: [{ action: 'click', selector: '#save' }] };
    const id = caseId('/', viewport, false, scenario);
    expect(id).toBe(caseId('/', viewport, false, { steps: [{ selector: '#save', action: 'click' }], name: 'saved' }));
    expect(id).not.toBe(caseId('/', viewport, false, { ...scenario, steps: [{ action: 'click', selector: '#retry' }] }));
    expect(id).not.toBe(caseId('/', viewport, false));
  });
});
