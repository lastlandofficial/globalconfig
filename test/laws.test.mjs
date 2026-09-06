import test from 'node:test';
import assert from 'node:assert/strict';
import { createLawsManager, lawRules } from '../dist/laws.js';
import { createGlobalConfig, getCountry, listCountries, resolveCountry } from '../dist/index.js';

test('country aliases and immutable profiles', () => {
  assert.equal(resolveCountry(' india '), 'IN');
  assert.equal(resolveCountry('USA'), 'US');
  assert.equal(getCountry('Japan').currency, 'JPY');
  assert.equal(listCountries().length, 3);
  for (const country of ['FR', '__proto__', 'constructor', null]) assert.throws(() => resolveCountry(country));
  assert.throws(() => { getCountry('IN').timeZones.push('UTC'); });
});
test('law catalog is filterable, sourced, and immutable', () => {
  const laws = createLawsManager();
  assert.equal(laws.list({ country: 'US', topic: 'children' })[0].id, 'us-coppa');
  for (const rule of laws.list()) {
    assert.match(rule.source, /^https:\/\//);
    assert.equal(rule.reviewedOn, '2026-09-06');
    assert.ok(rule.scope && rule.timing);
  }
  assert.throws(() => { lawRules[0].controls[0].title = 'changed'; });
});
test('missing context stays unknown and false facts do not claim compliance', () => {
  const laws = createLawsManager();
  const unknown = laws.assess({ country: 'US' });
  assert.ok(unknown.items.every(item => item.applicability === 'needs-context'));
  const review = laws.assess({ country: 'US', facts: { collectsPersonalData: true, ccpaApplies: true, servesChildrenUnder13: false } });
  assert.equal(review.items.find(x => x.rule.id === 'us-ccpa').applicability, 'review-required');
  assert.equal(review.items.find(x => x.rule.id === 'us-coppa').applicability, 'not-indicated');
  assert.equal('compliant' in review, false);
  assert.throws(() => laws.assess({ country: 'JP', facts: { collectsPersonalData: 'yes' } }));
  assert.throws(() => laws.assess({ country: 'JP', facts: { madeUp: true } }));
});
test('India phased commencement remains visible', () => {
  const item = createLawsManager().assess({ country: 'IN', facts: { collectsPersonalData: true }, on: '2026-09-06' }).items[0];
  assert.equal(item.timing, 'verify-commencement');
  assert.match(item.rule.timing, /Phased/);
  assert.equal(item.sourceReviewRequired, false);
  assert.equal(createLawsManager().assess({ country: 'IN', on: '2027-01-01' }).items[0].sourceReviewRequired, true);
});
test('records require evidence, persist via JSON, and remain isolated by instance', () => {
  const laws = createLawsManager();
  const record = { ruleId: 'jp-appi', controlId: 'purpose-notice', status: 'done', note: 'Reviewed in issue #42', updatedAt: '2026-09-06T12:00:00Z' };
  assert.throws(() => laws.record({ ...record, note: '' }), /evidence/);
  assert.throws(() => laws.record({ ...record, controlId: 'missing' }), /Unknown/);
  laws.record(record);
  const saved = JSON.parse(JSON.stringify(laws.exportRecords()));
  const restored = createLawsManager({ records: saved });
  assert.equal(restored.assess({ country: 'JP' }).items[0].controls[0].record.status, 'done');
  assert.equal(createLawsManager().exportRecords().length, 0);
});
test('custom law rules validate IDs and enforce explicit date windows', () => {
  const rule = { ...lawRules[0], id: 'custom', effectiveFrom: '2027-01-01', effectiveTo: '2028-01-01' };
  const laws = createLawsManager({ rules: [rule] });
  assert.equal(laws.assess({ country: 'IN', on: '2026-12-31' }).items[0].timing, 'upcoming');
  assert.equal(laws.assess({ country: 'IN', on: '2027-01-01' }).items[0].timing, 'within-period');
  assert.equal(laws.assess({ country: 'IN', on: '2028-01-01' }).items[0].timing, 'outside-period');
  assert.throws(() => laws.register(rule), /Duplicate/);
  assert.throws(() => createLawsManager({ rules: [{ ...rule, effectiveTo: '2026-01-01' }] }));
  assert.throws(() => createLawsManager({ rules: [{ ...rule, controls: [rule.controls[0], rule.controls[0]] }] }));
});
test('country-bound client supplies defaults and rejects mismatched tax country', () => {
  const app = createGlobalConfig({ country: 'India' });
  assert.equal(app.currency.format('1234.50'), '₹1,234.50');
  assert.equal(app.time.convert('2026-01-01T00:00Z').local, '2026-01-01T05:30:00');
  assert.equal(app.laws.assess().country, 'IN');
  assert.ok(app.laws.list().every(rule => rule.country === 'IN'));
  assert.equal(app.tax.calculate({ country: 'IN', amount: 100, rate: 18, supply: 'inter-state' }).gross, '118.00');
  assert.throws(() => app.tax.calculate({ country: 'JP', amount: 100, category: 'standard' }), /configured for IN/);
  assert.throws(() => createGlobalConfig({ country: 'US' }).time.convert(0), /multiple time zones/);
  assert.equal(createGlobalConfig({ country: 'US', timeZone: 'America/New_York' }).time.convert(0).offset, '-05:00');
});
