import { describe, expect, it } from 'vitest';
import { auditSnapshot, checkContract, defineContract, fingerprint, shouldFail, type ElementSnapshot, type Rule, type UISnapshot } from '../src/ui';
import { auditNative } from '../src/ui/native';
const element = (overrides: Partial<ElementSnapshot> = {}): ElementSnapshot => ({ target: '#save', tag: 'button', role: 'button', name: 'Save', visible: true, disabled: false, interactive: true, rect: { x: 0, y: 0, width: 44, height: 44 }, attributes: {}, styles: { display: 'inline-block' }, ignore: [], ...overrides });
const snapshot = (elements: ElementSnapshot[] = [], overrides: Partial<UISnapshot> = {}): UISnapshot => ({ platform: 'web', viewport: { width: 390, height: 844 }, document: { clientWidth: 390, scrollWidth: 390 }, elements, ...overrides });
const ids = (report: ReturnType<typeof auditSnapshot>) => report.findings.map(f => f.ruleId);

describe('evidence-based rules', () => {
  it('does not penalize an empty snapshot with imaginary missing UI', () => { expect(auditSnapshot(snapshot()).findings).toEqual([]); });
  it('reports measured overflow, allowing subpixel rounding', () => {
    expect(ids(auditSnapshot(snapshot([], { document: { clientWidth: 390, scrollWidth: 850 } })))).toContain('layout/overflow');
    expect(ids(auditSnapshot(snapshot([], { document: { clientWidth: 390, scrollWidth: 391 } })))).not.toContain('layout/overflow');
  });
  it('treats target size as a heuristic and excludes hidden, disabled, and inline controls', () => {
    const small = { rect: { x: 0, y: 0, width: 12, height: 12 } };
    const report = auditSnapshot(snapshot([element(small), element({ ...small, target: '#hidden', visible: false }), element({ ...small, target: '#disabled', disabled: true }), element({ ...small, target: '#inline', styles: { display: 'inline' } })]));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ ruleId: 'interaction/target-size', confidence: 'medium', severity: 'warning', evidence: { width: 12 } });
    expect(shouldFail(report)).toBe(false);
    expect(shouldFail(report, 'warning')).toBe(true);
  });
  it('requires an explicit scale and tolerates fractional rounding and negative margins', () => {
    const page = snapshot([element({ styles: { paddingTop: '13px', marginTop: '-8px', marginRight: '8.25px' } })]);
    expect(ids(auditSnapshot(page))).not.toContain('consistency/spacing');
    const report = auditSnapshot(page, { spacingScale: [0, 4, 8, 12, 16] });
    expect(report.findings[0]?.evidence.properties).toEqual(['paddingTop: 13px']);
  });
  it('compares declared peers only, requires a majority, and separates state and variant', () => {
    const peer = (target: string, padding: string, extra: Partial<ElementSnapshot> = {}) => element({ target, component: 'Button', styles: { paddingTop: padding }, ...extra });
    expect(ids(auditSnapshot(snapshot([peer('#a', '8px'), peer('#b', '8px'), peer('#c', '9px')])))).toContain('consistency/component-drift');
    expect(ids(auditSnapshot(snapshot([peer('#a', '8px'), peer('#b', '9px')])))).not.toContain('consistency/component-drift');
    expect(ids(auditSnapshot(snapshot([peer('#a', '8px'), peer('#b', '8px'), peer('#c', '9px', { variant: 'large' })])))).not.toContain('consistency/component-drift');
    expect(ids(auditSnapshot(snapshot([peer('#a', '8px'), peer('#b', '8px'), peer('#c', '9px', { disabled: true })])))).not.toContain('consistency/component-drift');
  });
  it('invalid fields need a linked description and placeholders need a visible label', () => {
    const bad = element({ tag: 'input', attributes: { 'aria-invalid': 'true', placeholder: 'present' } });
    expect(ids(auditSnapshot(snapshot([bad])))).toEqual(expect.arrayContaining(['form/error-description', 'form/placeholder-label']));
    const fixed = { ...bad, attributes: { ...bad.attributes, 'data-glocon-error-text': 'true', 'data-glocon-visible-label': 'true' } };
    expect(auditSnapshot(snapshot([fixed])).findings).toEqual([]);
  });
});
describe('report controls and custom rules', () => {
  const page = snapshot([element({ attributes: { tabindex: '3' } })]);
  it('preserves reasons for suppressed findings', () => {
    const report = auditSnapshot(page, { suppressions: [{ ruleId: 'interaction/positive-tabindex', target: '#save', reason: 'Legacy widget migration tracked separately' }] });
    expect(report.findings).toHaveLength(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.summary.total).toBe(0);
  });
  it('supports rule severity overrides and deterministic IDs', () => {
    const first = auditSnapshot(page, { rules: { 'interaction/positive-tabindex': 'error' } });
    expect(shouldFail(first)).toBe(true);
    expect(first.findings[0]?.fingerprint).toBe(auditSnapshot(page).findings[0]?.fingerprint);
    expect(fingerprint('a', 'bc')).not.toBe(fingerprint('ab', 'c'));
    expect(shouldFail(first, 'none')).toBe(false);
  });
  it('rejects config typos, invalid thresholds, and unreasoned suppressions', () => {
    expect(() => auditSnapshot(page, { rules: { typo: 'off' } })).toThrow('Unknown rule');
    expect(() => auditSnapshot(page, { targetSize: -1 })).toThrow('targetSize');
    expect(() => auditSnapshot(page, { spacingScale: [Number.NaN] })).toThrow('spacingScale');
    expect(() => auditSnapshot(page, { suppressions: [{ ruleId: 'anything', reason: '' }] })).toThrow('reason');
  });
  it('runs custom rules and rejects conflicting IDs', () => {
    const rule: Rule = { meta: { id: 'project/test', title: 'Required feature', rationale: 'Project policy', category: 'ux', severity: 'error', confidence: 'high' }, check: () => [{ target: 'app', message: 'Missing feature', evidence: {}, suggestion: 'Add feature' }] };
    expect(ids(auditSnapshot(page, {}, [rule]))).toContain('project/test');
    expect(() => auditSnapshot(page, {}, [rule, rule])).toThrow('unique');
  });
});
describe('state contracts', () => {
  const contract = defineContract({ name: 'orders', states: { loading: { required: [{ selector: '[role="status"]', description: 'loading feedback' }] }, error: { required: [{ selector: '#retry', description: 'a retry action' }] } } });
  it('separates an unobserved scenario from observed missing UI', () => {
    const report = checkContract(contract, { error: { visibleCounts: { '#retry': 0 } } });
    expect(report.summary).toEqual({ error: 1, warning: 1, info: 0, total: 2 });
    expect(report.findings[0]).toMatchObject({ ruleId: 'contract/missing-ui', evidence: { observed: 0 } });
    expect(report.findings[1]?.ruleId).toBe('contract/untested-state');
  });
  it('passes only when all declared requirements are observed', () => {
    const report = checkContract(contract, { loading: { visibleCounts: { '[role="status"]': 1 } }, error: { visibleCounts: { '#retry': 1 } } });
    expect(report.findings).toHaveLength(0);
  });
  it('rejects incomplete observations instead of reporting absence as fact', () => {
    expect(() => checkContract(contract, { error: { visibleCounts: {} } })).toThrow('Missing or invalid observation');
    expect(() => checkContract(contract, { erorr: { visibleCounts: {} } })).toThrow('Unknown observed state');
    expect(() => defineContract({ name: 'blank', states: {} })).toThrow('at least one state');
  });
});
describe('native adapter', () => {
  it('checks native names and native-sized targets without claiming device coverage', () => {
    const report = auditNative([{ testID: 'save', accessibilityRole: 'button', frame: { x: 0, y: 0, width: 30, height: 30 } }], { width: 390, height: 844 });
    expect(ids(report)).toEqual(expect.arrayContaining(['native/control-name', 'interaction/target-size']));
    expect(report.coverage.limitations.join(' ')).toContain('not device automation');
  });
  it('accepts computed accessible names and rejects duplicate native IDs', () => {
    const node = { testID: 'save', accessibilityRole: 'button', accessibleName: 'Save', frame: { x: 0, y: 0, width: 48, height: 48 } };
    expect(auditNative([node], { width: 390, height: 844 }).findings).toHaveLength(0);
    expect(() => auditNative([node, node], { width: 390, height: 844 })).toThrow('unique');
  });
});
