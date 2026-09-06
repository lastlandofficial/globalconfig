import { currencyCode, currencyDigits } from './countries';
import type { CurrencyCode } from './countries';
import { D, decimal, isoInstant, rounding } from './internal';
import type { Amount, RoundingMode } from './internal';
export type { Amount, RoundingMode } from './internal';

export interface ExchangeRates {
  /** Every rate is units of that currency per one unit of base. */
  readonly base: CurrencyCode;
  readonly rates: Readonly<Partial<Record<CurrencyCode, Amount>>>;
  /** ISO instant with Z or an explicit UTC offset. */
  readonly asOf: string;
  readonly source: string;
}
export interface ConversionOptions {
  amount: Amount;
  from: CurrencyCode;
  to: CurrencyCode;
  rates: ExchangeRates;
  rounding?: RoundingMode;
  maxAgeMs?: number;
  now?: Date;
}

export function convertCurrency(options: ConversionOptions) {
  const { amount, from, to, rates } = options;
  currencyCode(from); currencyCode(to); currencyCode(rates.base);
  const timestamp = isoInstant(rates.asOf);
  if (typeof rates.source !== 'string' || !rates.source.trim()) throw new TypeError('rates.source is required');
  if (options.maxAgeMs !== undefined) {
    const now = (options.now ?? new Date()).getTime();
    if (!Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0 || !Number.isFinite(now)) throw new RangeError('Invalid freshness options');
    if (timestamp > now || now - timestamp > options.maxAgeMs) throw new RangeError('Exchange rates are stale or future-dated');
  }
  for (const [code, value] of Object.entries(rates.rates)) {
    currencyCode(code);
    if (!decimal(value, 'exchange rate').gt(0)) throw new RangeError('Exchange rates must be positive');
  }
  if (rates.rates[rates.base] !== undefined && !decimal(rates.rates[rates.base]!).eq(1)) throw new RangeError('The base currency rate must equal 1');
  const rateFor = (code: CurrencyCode) => {
    if (code === rates.base) return new D(1);
    const rate = rates.rates[code];
    if (rate === undefined) throw new RangeError(`Missing exchange rate for ${code}`);
    return decimal(rate, 'exchange rate');
  };
  const rate = from === to ? new D(1) : rateFor(to).div(rateFor(from));
  return Object.freeze({
    amount: decimal(amount).mul(rate).toFixed(currencyDigits(to), rounding(options.rounding)),
    from, to, rate: rate.toString(), asOf: rates.asOf, source: rates.source,
  });
}

/** Adapter point for your bank, FX vendor, cache, or server endpoint. No implicit network requests. */
export function createCurrencyConverter(provider: () => Promise<ExchangeRates>) {
  return async (options: Omit<ConversionOptions, 'rates'>) => convertCurrency({ ...options, rates: await provider() });
}

export function toMinorUnits(amount: Amount, currency: CurrencyCode, mode: RoundingMode = 'half-up'): bigint {
  return BigInt(decimal(amount).mul(new D(10).pow(currencyDigits(currency))).toFixed(0, rounding(mode)));
}

export function fromMinorUnits(amount: bigint | string, currency: CurrencyCode): string {
  if ((typeof amount !== 'string' && typeof amount !== 'bigint') || !/^-?\d+$/.test(String(amount))) throw new TypeError('Minor units must be a bigint or integer string');
  const value = decimal(String(amount), 'minor units');
  return value.div(new D(10).pow(currencyDigits(currency))).toFixed(currencyDigits(currency));
}

export interface MoneyFormatOptions {
  locale?: string;
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
  rounding?: RoundingMode;
}
export function formatCurrency(amount: Amount, currency: CurrencyCode, options: MoneyFormatOptions = {}): string {
  const digits = currencyDigits(currency);
  const fixed = decimal(amount).toFixed(digits, rounding(options.rounding));
  const locale = options.locale ?? ({ INR: 'en-IN', USD: 'en-US', JPY: 'ja-JP' } as const)[currency];
  // Modern Intl accepts decimal strings losslessly; the cast bridges older TS lib declarations.
  return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: options.currencyDisplay ?? 'symbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(fixed as unknown as number);
}
