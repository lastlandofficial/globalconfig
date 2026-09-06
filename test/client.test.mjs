import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalConfig } from 'glocon';

test('short country setup matches the options form and accepts existing aliases', () => {
  for (const [input, code] of [['IN', 'IN'], [' india ', 'IN'], ['USA', 'US'], ['Japan', 'JP']]) {
    const short = createGlobalConfig(input);
    const full = createGlobalConfig({ country: input });
    assert.equal(short.country.code, code);
    assert.equal(short.currency.format('100'), full.currency.format('100'));
    assert.equal(short.laws.assess().country, code);
    assert.ok(Object.isFrozen(short));
  }
  for (const input of [undefined, null, 42, {}, 'France']) {
    assert.throws(() => createGlobalConfig(input), /country|Unsupported/);
  }
});

test('country setup still honors locale and explicit US time zones', () => {
  const app = createGlobalConfig({ country: 'US', locale: 'en-GB', timeZone: 'America/New_York' });
  assert.equal(app.locale, 'en-GB');
  assert.equal(app.currency.format('12.50', { currencyDisplay: 'code' }), 'USD\u00a012.50');
  assert.equal(app.time.convert('2026-01-01T00:00:00Z').local, '2025-12-31T19:00:00');
  assert.throws(() => createGlobalConfig('US').time.convert(0), /multiple time zones/);
});

test('tax calls inherit the client country and preserve explicit-country calls', () => {
  const fixtures = [
    ['IN', { amount: '1000', rate: '18', supply: 'intra-state' }, '1180.00'],
    ['US', { amount: '100', rate: '8.875', jurisdiction: 'Example district' }, '108.88'],
    ['JP', { amount: '1000', category: 'standard' }, '1100'],
    ['JP', { amount: '1080', category: 'reduced', inclusive: true }, '1080'],
    ['JP', { amount: '1000', rate: '5' }, '1050'],
  ];
  for (const [country, input, gross] of fixtures) {
    const app = createGlobalConfig(country);
    const result = app.tax.calculate(Object.freeze(input));
    assert.equal(result.country, country);
    assert.equal(result.gross, gross);
    assert.deepEqual(result, app.tax.calculate({ ...input, country }));
  }
});

test('inferred tax country does not hide missing fields or conflicting inputs', () => {
  const india = createGlobalConfig('IN');
  const us = createGlobalConfig('US');
  const japan = createGlobalConfig('JP');
  assert.throws(() => india.tax.calculate({ amount: '100', rate: '18' }), /supply/);
  assert.throws(() => us.tax.calculate({ amount: '100', rate: '8' }), /jurisdiction/);
  assert.throws(() => japan.tax.calculate({ amount: '1000', category: 'standard', rate: '8' }), /not both/);
  assert.throws(() => india.tax.calculate({ country: 'JP', amount: '1000', category: 'standard' }), /configured for IN/);
  assert.throws(() => us.tax.calculate({ amount: '100', category: 'standard' }));
  assert.throws(() => india.tax.calculate({ amount: '-100', rate: '18', supply: 'intra-state' }));
});

test('client minor-unit helpers use the currency precision and explicit rounding', () => {
  const india = createGlobalConfig('IN');
  const us = createGlobalConfig('US');
  const japan = createGlobalConfig('JP');
  assert.equal(india.currency.toMinorUnits('10.25'), 1025n);
  assert.equal(india.currency.fromMinorUnits(1025n), '10.25');
  assert.equal(us.currency.toMinorUnits('1.005'), 101n);
  assert.equal(us.currency.toMinorUnits('1.005', 'half-even'), 100n);
  assert.equal(us.currency.fromMinorUnits('-125'), '-1.25');
  assert.equal(japan.currency.toMinorUnits('100.5'), 101n);
  assert.equal(japan.currency.fromMinorUnits('101'), '101');
  assert.equal(us.currency.fromMinorUnits(us.currency.toMinorUnits('90071992547409.93')), '90071992547409.93');
  assert.throws(() => india.currency.fromMinorUnits('10.25'), /integer/);
  assert.throws(() => india.currency.toMinorUnits('Infinity'));
});
