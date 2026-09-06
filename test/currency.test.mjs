import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from 'decimal.js';
import { convertCurrency, createCurrencyConverter, formatCurrency, fromMinorUnits, toMinorUnits } from '../dist/currency.js';

const rates = { base: 'USD', rates: { INR: '83.25', JPY: '150' }, asOf: '2026-09-01T00:00:00Z', source: 'Test fixture — not market data' };
const convert = (overrides = {}) => convertCurrency({ amount: '10', from: 'USD', to: 'INR', rates, ...overrides });

test('converts direct, inverse, and cross rates', () => {
  assert.equal(convert().amount, '832.50');
  assert.equal(convert({ amount: '832.50', from: 'INR', to: 'USD' }).amount, '10.00');
  assert.equal(convert({ amount: '832.50', from: 'INR', to: 'JPY' }).amount, '1500');
  assert.equal(convert().source, rates.source);
});
test('same-currency conversion does not need a missing quote', () => {
  assert.equal(convert({ amount: '-1.005', from: 'INR', to: 'INR', rates: { ...rates, rates: {} } }).amount, '-1.01');
});
test('exact decimal rounding includes half-even and JPY', () => {
  assert.equal(toMinorUnits('1.005', 'USD'), 101n);
  assert.equal(toMinorUnits('1.005', 'USD', 'half-even'), 100n);
  assert.equal(toMinorUnits('-1.005', 'USD'), -101n);
  assert.equal(toMinorUnits('1.5', 'JPY'), 2n);
  assert.equal(fromMinorUnits(101n, 'USD'), '1.01');
  assert.equal(fromMinorUnits('-150', 'JPY'), '-150');
});
test('large amounts retain precision when formatted', () => {
  assert.equal(formatCurrency('9007199254740993.12', 'USD'), '$9,007,199,254,740,993.12');
  assert.equal(formatCurrency('1234567.89', 'INR'), '₹12,34,567.89');
  assert.equal(formatCurrency('1500.5', 'JPY'), '￥1,501');
});
test('host Decimal configuration cannot change calculations', () => {
  const precision = Decimal.precision;
  Decimal.set({ precision: 2 });
  try { assert.equal(convert().amount, '832.50'); } finally { Decimal.set({ precision }); }
});
test('rejects non-finite, malformed, excessive, or unsupported money', () => {
  for (const amount of [NaN, Infinity, '', '1e3', '0x10', '1,000', ' 1', null, {}, '1.0000000000000000001', '1000000000000000000000000000000']) assert.throws(() => convert({ amount }));
  assert.throws(() => toMinorUnits('1', 'EUR'));
  assert.throws(() => fromMinorUnits('1.2', 'USD'));
  assert.throws(() => fromMinorUnits(123, 'USD'));
  assert.throws(() => toMinorUnits('1', 'USD', 'invalid'));
});
test('validates exchange rate values, base, and metadata', () => {
  for (const patch of [{ rates: {} }, { rates: { INR: '0' } }, { rates: { INR: '-1' } }, { rates: { INR: '1', USD: '2' } }, { source: '' }, { asOf: '2026-01-01' }, { rates: { INR: '1', EUR: '1' } }]) assert.throws(() => convert({ rates: { ...rates, ...patch } }));
});
test('freshness handles stale, future, and boundary timestamps', () => {
  assert.equal(convert({ maxAgeMs: 1000, now: new Date('2026-09-01T00:00:01Z') }).amount, '832.50');
  assert.throws(() => convert({ maxAgeMs: 999, now: new Date('2026-09-01T00:00:01Z') }), /stale/);
  assert.throws(() => convert({ maxAgeMs: 1000, now: new Date('2026-08-31T23:59:59Z') }), /future/);
  assert.throws(() => convert({ maxAgeMs: -1 }));
});
test('FX dates reject impossible calendar days and rollover hours', () => {
  for (const asOf of ['2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z']) assert.throws(() => convert({ rates: { ...rates, asOf } }));
});
test('async adapters fetch explicitly and propagate failures', async () => {
  const converter = createCurrencyConverter(async () => rates);
  assert.equal((await converter({ amount: '10', from: 'USD', to: 'INR' })).amount, '832.50');
  await assert.rejects(createCurrencyConverter(async () => { throw new Error('provider unavailable'); })({ amount: '10', from: 'USD', to: 'INR' }), /provider unavailable/);
});
