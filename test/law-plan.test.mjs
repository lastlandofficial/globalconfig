import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalConfig, createLawsManager, lawRules, appFacts } from 'glocon';

test('plans ask each missing fact once and preserve undecided applicability', () => {
  const plan = createGlobalConfig('US').laws.plan({ on: '2026-09-06' });
  const personalData = plan.questions.find(question => question.fact === 'collectsPersonalData');
  assert.deepEqual(personalData.ruleIds, ['us-ccpa', 'us-coppa']);
  assert.equal(plan.questions.length, 4);
  assert.equal(new Set(plan.questions.map(question => question.fact)).size, 4);
  assert.ok(plan.questions.every(question => question.question && question.help && question.sources.length));
  assert.ok(plan.tasks.every(task => task.applicability === 'needs-context'));
  assert.equal('compliant' in plan, false);
  assert.deepEqual(plan.sourcesToReview, []);
});

test('false AND conditions suppress irrelevant questions and implementation tasks', () => {
  const app = createGlobalConfig('US');
  const plan = app.laws.plan({ facts: { collectsPersonalData: false, sellsTaxableItems: false } });
  assert.deepEqual(plan.questions, []);
  assert.deepEqual(plan.tasks, []);
  assert.equal(plan.progress.total, 0);
  assert.match(plan.scope, /not exhaustive/);
  assert.equal(app.laws.assess({ facts: { collectsPersonalData: false } }).items.length, 3);
});

test('plans retain implementation guidance, source dates, timing, and evidence', () => {
  const app = createGlobalConfig('JP');
  const plan = app.laws.plan({ facts: { collectsPersonalData: false, sellsTaxableItems: true }, on: '2026-09-07' });
  assert.equal(plan.tasks.length, 3);
  const invoice = plan.tasks.find(task => task.controlId === 'invoices-and-filings');
  assert.match(invoice.implementation[0], /once per rate/);
  assert.match(invoice.source, /nta.go.jp.*6371/);
  assert.ok(invoice.evidence.length);
  assert.equal(invoice.reviewedOn, '2026-09-06');
  assert.equal(invoice.sourceReviewRequired, true);
  assert.ok(plan.sourcesToReview.includes(invoice.source));
  assert.equal(new Set(plan.sourcesToReview).size, plan.sourcesToReview.length);
  const india = createGlobalConfig('IN').laws.plan({ facts: { collectsPersonalData: true, sellsTaxableItems: false } });
  assert.ok(india.tasks.every(task => task.timing === 'verify-commencement'));
  assert.match(india.tasks[0].timingNote, /Phased/);
});

test('saved facts and evidence restore a plan without repeating configuration', () => {
  const facts = { collectsPersonalData: true, sellsTaxableItems: false };
  const record = { ruleId: 'jp-appi', controlId: 'purpose-notice', status: 'done', note: 'Reviewed notice in PR #12', updatedAt: '2026-09-06T12:00:00Z' };
  const app = createGlobalConfig({ country: 'JP', facts, records: [record] });
  facts.collectsPersonalData = false;
  record.note = 'changed by caller';
  const before = app.laws.plan();
  assert.equal(before.questions.length, 0);
  assert.equal(before.progress.done, 1);
  assert.equal(before.tasks[0].record.note, 'Reviewed notice in PR #12');
  app.laws.record({ ruleId: 'jp-appi', controlId: 'security-rights', status: 'in-progress', note: 'Implementing request workflow', updatedAt: '2026-09-06T13:00:00Z' });
  assert.equal(app.laws.plan().progress.inProgress, 1);
  assert.equal(before.progress.inProgress, 0);
  assert.equal(app.laws.plan({ facts: { collectsPersonalData: false } }).tasks.length, 0);
  assert.equal(app.laws.plan().tasks.length, 3);
  assert.throws(() => before.tasks[0].implementation.push('changed'));
  assert.throws(() => { appFacts.ccpaApplies.help = 'changed'; });
});

test('expired custom rules do not produce work, and upcoming work stays labelled', () => {
  const rules = [
    { ...lawRules[0], id: 'expired', effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01' },
    { ...lawRules[0], id: 'upcoming', effectiveFrom: '2027-01-01' },
  ];
  const laws = createLawsManager({ rules });
  const plan = laws.plan({ country: 'IN', on: '2026-09-06' });
  assert.ok(plan.tasks.every(task => task.ruleId === 'upcoming' && task.timing === 'upcoming'));
  assert.deepEqual(plan.questions[0].ruleIds, ['upcoming']);
  const expiredOnly = createLawsManager({ rules: [rules[0]] }).plan({ country: 'IN', on: '2026-01-01' });
  assert.deepEqual(expiredOnly.tasks, []);
  assert.deepEqual(expiredOnly.questions, []);
});

test('custom guidance is copied and optional, with runtime validation', () => {
  const implementation = ['Implement a reviewed custom workflow'];
  const evidence = ['A test result'];
  const custom = { ...lawRules[0], id: 'custom', controls: [{ id: 'control', title: 'Custom control', implementation, evidence, source: 'https://example.com/official-policy' }] };
  const laws = createLawsManager({ rules: [custom] });
  implementation.push('later edit');
  evidence.push('later edit');
  const plan = laws.plan({ country: 'IN' });
  assert.deepEqual(plan.tasks[0].implementation, ['Implement a reviewed custom workflow']);
  assert.deepEqual(plan.tasks[0].evidence, ['A test result']);
  assert.equal(plan.tasks[0].source, custom.controls[0].source);
  const minimal = createLawsManager({ rules: [{ ...custom, controls: [{ id: 'minimal', title: 'Manual review' }] }] }).plan({ country: 'IN' });
  assert.deepEqual(minimal.tasks[0].implementation, []);
  assert.equal(minimal.tasks[0].source, custom.source);
  for (const fields of [{ implementation: 'text' }, { evidence: [''] }, { source: 'http://example.com' }]) {
    assert.throws(() => createLawsManager({ rules: [{ ...custom, controls: [{ id: 'bad', title: 'Bad', ...fields }] }] }));
  }
  for (const facts of [null, [], 'yes', { ccpaApplies: 'yes' }, { madeUp: true }]) {
    assert.throws(() => laws.plan({ country: 'IN', facts }));
    assert.throws(() => createGlobalConfig({ country: 'IN', facts }));
    assert.throws(() => createGlobalConfig('IN').laws.plan({ facts }));
  }
});

test('every bundled control has source-backed implementation suggestions', () => {
  for (const rule of lawRules) for (const control of rule.controls) {
    assert.ok(control.implementation?.length, `${rule.id}/${control.id} needs implementation guidance`);
    assert.ok(control.evidence?.length, `${rule.id}/${control.id} needs evidence suggestions`);
    assert.equal(new URL(control.source).protocol, 'https:');
  }
  const coppa = lawRules.find(rule => rule.id === 'us-coppa');
  assert.ok(coppa.controls.some(control => control.id === 'third-party-consent'));
  assert.ok(coppa.controls.some(control => control.id === 'retention-policy'));
});
