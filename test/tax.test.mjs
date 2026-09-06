import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTax, calculateProgressiveTax, createTaxManager } from '../dist/tax.js';

test('India GST splits and totals reconcile', () => {
  const result = calculateTax({ country: 'IN', amount: '1000.00', rate: '18', supply: 'intra-state' });
  assert.equal(result.tax, '180.00'); assert.equal(result.gross, '1180.00');
  assert.deepEqual(result.components.map(x => [x.name, x.amount]), [['CGST', '90.00'], ['SGST', '90.00']]);
  assert.equal(calculateTax({ country: 'IN', amount: '100', rate: 18, supply: 'intra-state', localTax: 'UTGST' }).components[1].name, 'UTGST');
  assert.equal(calculateTax({ country: 'IN', amount: '100', rate: 18, supply: 'inter-state' }).components[0].name, 'IGST');
});
test('inclusive GST extracts tax without adding it twice', () => {
  const result = calculateTax({ country: 'IN', amount: '1180', rate: 18, supply: 'inter-state', inclusive: true });
  assert.equal(result.net, '1000.00'); assert.equal(result.tax, '180.00'); assert.equal(result.gross, '1180.00');
});
test('odd paisa allocations reconcile rather than independently rounding both halves', () => {
  const result = calculateTax({ country: 'IN', amount: '0.03', rate: 18, supply: 'intra-state' });
  assert.equal(result.tax, '0.01');
  assert.deepEqual(result.components.map(x => x.amount), ['0.01', '0.00']);
});
test('US requires an explicit combined rate and jurisdiction', () => {
  const result = calculateTax({ country: 'US', amount: '100', rate: '8.875', jurisdiction: 'Example district' });
  assert.equal(result.tax, '8.88'); assert.equal(result.gross, '108.88');
  assert.throws(() => calculateTax({ country: 'US', amount: '100', rate: '8' }), /jurisdiction/);
  assert.throws(() => calculateTax({ country: 'US', amount: '100', jurisdiction: 'CA' }));
});
test('Japan categories and invoice-level rounding handle whole yen', () => {
  assert.equal(calculateTax({ country: 'JP', amount: '1000', category: 'standard' }).gross, '1100');
  assert.equal(calculateTax({ country: 'JP', amount: '1080', category: 'reduced', inclusive: true }).net, '1000');
  assert.equal(calculateTax({ country: 'JP', amount: '105', category: 'standard', rounding: 'down' }).tax, '10');
  assert.equal(calculateTax({ country: 'JP', amount: '105', category: 'standard' }).tax, '11');
  assert.throws(() => calculateTax({ country: 'JP', amount: '10', category: 'standard', rate: 5 }));
});
test('tax arithmetic rejects invalid runtime configuration', () => {
  for (const patch of [{ amount: '-1' }, { amount: '1.5' }, { rate: 101 }, { rate: -1 }, { inclusive: 'true' }]) assert.throws(() => calculateTax({ country: 'JP', amount: '10', rate: 10, ...patch }));
  assert.throws(() => calculateTax({ country: 'IN', amount: 10, rate: 18 }));
  assert.throws(() => calculateTax({ country: 'IN', amount: 10, rate: 18, supply: 'intra-state', localTax: 'bad' }));
  assert.throws(() => calculateTax({ country: 'JP', amount: 10, category: 'invalid' }));
  assert.throws(() => calculateTax({ country: 'FR', amount: 10, rate: 10 }));
});
test('progressive schedules apply marginal rates and boundary conditions', () => {
  const brackets = [{ upTo: '10000', rate: 0 }, { upTo: '20000', rate: 10 }, { upTo: null, rate: 20 }];
  for (const [taxableIncome, tax] of [['0', '0.00'], ['10000', '0.00'], ['20000', '1000.00'], ['30000', '3000.00']]) {
    assert.equal(calculateProgressiveTax({ taxableIncome, currency: 'USD', brackets }).tax, tax);
  }
  assert.equal(calculateProgressiveTax({ taxableIncome: 0, currency: 'USD', brackets }).effectiveRate, '0');
});
test('malformed progressive schedules fail even for zero income', () => {
  for (const brackets of [[], [{ upTo: 100, rate: 1 }], [{ upTo: null, rate: 1 }, { upTo: null, rate: 2 }], [{ upTo: 100, rate: 1 }, { upTo: 50, rate: 2 }, { upTo: null, rate: 3 }], [{ upTo: null, rate: -1 }]]) assert.throws(() => calculateProgressiveTax({ taxableIncome: 0, currency: 'USD', brackets }));
});
test('rate manager validates dates, isolates input, and enforces exclusive expiry', () => {
  const rule = { id: 'example', country: 'IN', rate: '18', effectiveFrom: '2026-01-01', effectiveTo: '2027-01-01', source: 'Caller verified schedule' };
  const manager = createTaxManager([rule]);
  rule.rate = '5';
  assert.equal(manager.getRate('example', '2026-01-01').rate, '18');
  assert.throws(() => manager.getRate('example', '2027-01-01'), /not effective/);
  assert.throws(() => manager.getRate('example', '2026-02-30'), /Invalid date/);
  assert.throws(() => manager.getRate('missing', '2026-01-01'), /Unknown/);
  assert.throws(() => manager.register(rule), /Duplicate/);
});
