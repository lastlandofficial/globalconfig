import { Decimal } from 'decimal.js';

// Isolate precision and rounding from the host application's Decimal settings.
export const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
export type Amount = string | number;
export type RoundingMode = 'half-up' | 'half-even' | 'down' | 'up';
const modes = { 'half-up': Decimal.ROUND_HALF_UP, 'half-even': Decimal.ROUND_HALF_EVEN, down: Decimal.ROUND_DOWN, up: Decimal.ROUND_UP } as const;

export function rounding(mode: RoundingMode = 'half-up'): Decimal.Rounding {
  if (!Object.hasOwn(modes, mode)) throw new RangeError(`Unknown rounding mode: ${mode}`);
  return modes[mode];
}

export function decimal(value: Amount, label = 'amount'): Decimal {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && !/^[+-]?\d+(?:\.\d+)?$/.test(value))) {
    throw new TypeError(`${label} must be a finite number or a plain decimal string`);
  }
  const result = new D(value);
  if (!result.isFinite() || result.abs().gte('1e30') || result.decimalPlaces() > 18) {
    throw new RangeError(`${label} must be finite, below 1e30, and have at most 18 decimal places`);
  }
  return result;
}

export function nonNegative(value: Amount, label: string): Decimal {
  const result = decimal(value, label);
  if (result.isNegative()) throw new RangeError(`${label} must be non-negative`);
  return result;
}

export function percent(value: Amount): Decimal {
  const result = nonNegative(value, 'rate');
  if (result.gt(100)) throw new RangeError('rate must be between 0 and 100 (18 means 18%)');
  return result;
}

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function dateOnly(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Expected a YYYY-MM-DD date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError(`Invalid date: ${value}`);
  return value;
}

export function isoInstant(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new RangeError('Expected an ISO instant with Z or an explicit UTC offset');
  dateOnly(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23) throw new RangeError('Invalid ISO hour');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError('Invalid ISO instant');
  return timestamp;
}
