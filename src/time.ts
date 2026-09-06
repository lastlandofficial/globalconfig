import { Temporal } from '@js-temporal/polyfill';
import { getCountry } from './countries';

export type Disambiguation = 'reject' | 'earlier' | 'later' | 'compatible';
export type InstantInput = string | Date | number;

export function resolveTimeZone(countryOrZone: string): string {
  if (typeof countryOrZone !== 'string' || !countryOrZone.trim()) throw new TypeError('A country or IANA time zone is required');
  if (countryOrZone.includes('/') || countryOrZone === 'UTC') {
    // Validate with the same implementation used for conversion.
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(countryOrZone);
    return countryOrZone;
  }
  const country = getCountry(countryOrZone);
  if (country.timeZones.length !== 1) throw new RangeError(`${country.name} has multiple time zones. Supply an IANA zone such as America/New_York`);
  return country.timeZones[0]!;
}

function instant(value: InstantInput): Temporal.Instant {
  if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(value.getTime());
  if (typeof value === 'number') return Temporal.Instant.fromEpochMilliseconds(value);
  if (typeof value !== 'string') throw new TypeError('Expected an ISO instant, Date, or epoch milliseconds');
  return Temporal.Instant.from(value);
}

function result(value: Temporal.ZonedDateTime) {
  return Object.freeze({ instant: value.toInstant().toString(), local: value.toPlainDateTime().toString(), timeZone: value.timeZoneId, offset: value.offset, zoned: value.toString(), epochMilliseconds: value.epochMilliseconds });
}

/** Convert an unambiguous instant to a local wall clock. Strings must include an offset. */
export function convertTime(value: InstantInput, to: string) {
  return result(instant(value).toZonedDateTimeISO(resolveTimeZone(to)));
}

/** Convert a local wall clock; reject nonexistent/duplicated DST times unless explicitly resolved. */
export function convertLocalTime(value: string, options: { from: string; to: string; disambiguation?: Disambiguation }) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(value)) throw new RangeError('Expected YYYY-MM-DDTHH:mm[:ss[.fraction]] without an offset');
  const local = Temporal.PlainDateTime.from(value, { overflow: 'reject' });
  const zoned = local.toZonedDateTime(resolveTimeZone(options.from), { disambiguation: options.disambiguation ?? 'reject' });
  return result(zoned.withTimeZone(resolveTimeZone(options.to)));
}

export function formatTime(value: InstantInput, options: { timeZone: string; locale?: string; dateStyle?: 'full' | 'long' | 'medium' | 'short'; timeStyle?: 'full' | 'long' | 'medium' | 'short' }): string {
  return new Intl.DateTimeFormat(options.locale ?? 'en-US', { timeZone: resolveTimeZone(options.timeZone), dateStyle: options.dateStyle ?? 'medium', timeStyle: options.timeStyle ?? 'short' }).format(instant(value).epochMilliseconds);
}
