import test from 'node:test';
import assert from 'node:assert/strict';
import { convertTime, convertLocalTime, formatTime, resolveTimeZone } from '../dist/time.js';

test('instant conversion preserves instant and handles fractional offsets and dates', () => {
  const india = convertTime('2026-01-01T20:00:00Z', 'IN');
  assert.equal(india.local, '2026-01-02T01:30:00');
  assert.equal(india.offset, '+05:30');
  assert.equal(convertTime(india.instant, 'JP').local, '2026-01-02T05:00:00');
  assert.equal(convertTime(0, 'JP').instant, '1970-01-01T00:00:00Z');
  assert.equal(convertTime(new Date(0), 'UTC').epochMilliseconds, 0);
});
test('US zones follow summer/winter rules and Arizona does not shift', () => {
  assert.equal(convertTime('2026-01-01T12:00Z', 'America/New_York').offset, '-05:00');
  assert.equal(convertTime('2026-07-01T12:00Z', 'America/New_York').offset, '-04:00');
  for (const month of ['01', '07']) assert.equal(convertTime(`2026-${month}-01T12:00Z`, 'America/Phoenix').offset, '-07:00');
});
test('ambiguous US country, invalid dates, offset-free instants and invalid zones throw', () => {
  assert.throws(() => resolveTimeZone('USA'), /multiple time zones/);
  for (const input of ['2026-01-01T12:00', '2026-02-30T00:00Z', new Date(NaN), NaN]) assert.throws(() => convertTime(input, 'JP'));
  assert.throws(() => convertTime(0, 'Invalid/Zone'));
});
test('DST gap is rejected by default and can be resolved explicitly', () => {
  const options = { from: 'America/New_York', to: 'UTC' };
  assert.throws(() => convertLocalTime('2026-03-08T02:30', options));
  assert.equal(convertLocalTime('2026-03-08T02:30', { ...options, disambiguation: 'later' }).instant, '2026-03-08T07:30:00Z');
});
test('DST overlap exposes both distinct instants', () => {
  const options = { from: 'America/New_York', to: 'JP' };
  assert.throws(() => convertLocalTime('2026-11-01T01:30', options));
  const early = convertLocalTime('2026-11-01T01:30', { ...options, disambiguation: 'earlier' });
  const late = convertLocalTime('2026-11-01T01:30', { ...options, disambiguation: 'later' });
  assert.equal(late.epochMilliseconds - early.epochMilliseconds, 3600000);
});
test('local conversion supports nanoseconds and rejects unexpected offsets', () => {
  assert.equal(convertLocalTime('2026-01-01T09:00:00.123456789', { from: 'JP', to: 'IN' }).local, '2026-01-01T05:30:00.123456789');
  for (const value of ['2026-02-30T12:00', '2026-01-01', '2026-01-01T12:00Z', '2026-01-01T12:00+09:00']) assert.throws(() => convertLocalTime(value, { from: 'JP', to: 'IN' }));
});
test('formatting uses an explicit locale and destination', () => {
  assert.match(formatTime('2026-01-01T00:00Z', { timeZone: 'IN', locale: 'en-US' }), /5:30/);
});
