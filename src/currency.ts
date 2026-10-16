import { currencyCode, currencyDigits } from "./countries";
import type { CurrencyCode } from "./countries";
import {
  D,
  assertDecimalInputLength,
  assertMoneyOutput,
  decimal,
  isoInstant,
  rounding,
} from "./internal";
import type { Amount, RoundingMode } from "./internal";
import { formatExactCurrency } from "./currency-format";
export type { Amount, RoundingMode } from "./internal";

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
  const { base, asOf, source, rates: suppliedQuotes } = rates;
  currencyCode(from);
  currencyCode(to);
  currencyCode(base);
  const timestamp = isoInstant(asOf);
  if (typeof source !== "string" || !source.trim())
    throw new TypeError("rates.source is required");
  if (options.maxAgeMs !== undefined) {
    const now = (options.now ?? new Date()).getTime();
    if (
      !Number.isFinite(options.maxAgeMs) ||
      options.maxAgeMs < 0 ||
      !Number.isFinite(now)
    )
      throw new RangeError("Invalid freshness options");
    if (timestamp > now || now - timestamp > options.maxAgeMs)
      throw new RangeError("Exchange rates are stale or future-dated");
  }
  if (
    !suppliedQuotes ||
    typeof suppliedQuotes !== "object" ||
    Array.isArray(suppliedQuotes)
  )
    throw new TypeError("Exchange rates must be an object of currency quotes");
  const quotes = new Map<CurrencyCode, InstanceType<typeof D>>();
  for (const code of Object.getOwnPropertyNames(suppliedQuotes)) {
    const currency = currencyCode(code);
    // Read each own quote once so provider getters cannot change after validation.
    const quote = decimal(suppliedQuotes[currency]!, "exchange rate");
    if (!quote.gt(0)) throw new RangeError("Exchange rates must be positive");
    quotes.set(currency, quote);
  }
  if (quotes.has(base) && !quotes.get(base)!.eq(1))
    throw new RangeError("The base currency rate must equal 1");
  const rateFor = (code: CurrencyCode) => {
    if (code === base) return new D(1);
    const rate = quotes.get(code);
    if (rate === undefined)
      throw new RangeError(`Missing exchange rate for ${code}`);
    return rate;
  };
  const sourceQuote = from === to ? new D(1) : rateFor(from);
  const targetQuote = from === to ? new D(1) : rateFor(to);
  const digits = currencyDigits(to);
  const value = decimal(amount);
  const converted = roundExactConversion(
    value,
    sourceQuote,
    targetQuote,
    digits,
    options.rounding,
  );
  assertMoneyOutput(new D(converted), "Converted money");
  return Object.freeze({
    amount: converted,
    from,
    to,
    rate: targetQuote.div(sourceQuote).toString(),
    asOf,
    source,
  });
}

/** Round only the final rational result; a finite decimal cross rate can move an exact tie. */
function roundExactConversion(
  amount: InstanceType<typeof D>,
  source: InstanceType<typeof D>,
  target: InstanceType<typeof D>,
  digits: number,
  mode: RoundingMode = "half-up",
): string {
  rounding(mode);
  const fraction = (value: InstanceType<typeof D>) => {
    const places = value.decimalPlaces();
    return {
      numerator: BigInt(value.abs().toFixed(places).replace(".", "")),
      denominator: 10n ** BigInt(places),
    };
  };
  const a = fraction(amount);
  const s = fraction(source);
  const t = fraction(target);
  const numerator =
    a.numerator * t.numerator * s.denominator * 10n ** BigInt(digits);
  const denominator = a.denominator * t.denominator * s.numerator;
  let units = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (
    (mode === "up" && remainder !== 0n) ||
    (mode === "half-up" && twice >= denominator) ||
    (mode === "half-even" &&
      (twice > denominator || (twice === denominator && units % 2n === 1n)))
  )
    units++;
  const text = units.toString().padStart(digits + 1, "0");
  const fixed =
    digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return amount.isNegative() && !amount.isZero() ? `-${fixed}` : fixed;
}

/** Adapter point for your bank, FX vendor, cache, or server endpoint. No implicit network requests. */
export function createCurrencyConverter(
  provider: () => Promise<ExchangeRates>,
) {
  return async (options: Omit<ConversionOptions, "rates">) =>
    convertCurrency({ ...options, rates: await provider() });
}

export function toMinorUnits(
  amount: Amount,
  currency: CurrencyCode,
  mode: RoundingMode = "half-up",
): bigint {
  const digits = currencyDigits(currency);
  const value = assertMoneyOutput(
    decimal(amount).toDecimalPlaces(digits, rounding(mode)),
  );
  return BigInt(value.mul(new D(10).pow(digits)).toFixed(0));
}

export function fromMinorUnits(
  amount: bigint | string,
  currency: CurrencyCode,
): string {
  if (typeof amount === "string")
    assertDecimalInputLength(amount, "Minor units");
  if (
    (typeof amount !== "string" && typeof amount !== "bigint") ||
    !/^-?\d+$/.test(String(amount))
  )
    throw new TypeError("Minor units must be a bigint or integer string");
  const digits = currencyDigits(currency);
  // The integer grows by 10^digits when encoding; apply the bound in major units.
  const integer = String(amount);
  if (integer.replace(/^-?0*/, "").length > 30 + digits)
    throw new RangeError("Minor units must represent a magnitude below 1e30");
  const value = new D(integer).div(new D(10).pow(digits));
  if (value.abs().gte("1e30"))
    throw new RangeError("Minor units must represent a magnitude below 1e30");
  return value.toFixed(digits);
}

export interface MoneyFormatOptions {
  locale?: string;
  currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
  rounding?: RoundingMode;
}
export function formatCurrency(
  amount: Amount,
  currency: CurrencyCode,
  options: MoneyFormatOptions = {},
): string {
  const digits = currencyDigits(currency);
  const fixed = decimal(amount).toFixed(digits, rounding(options.rounding));
  assertMoneyOutput(new D(fixed));
  const locale =
    options.locale ??
    ({ INR: "en-IN", USD: "en-US", JPY: "ja-JP" } as const)[currency];
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: options.currencyDisplay ?? "symbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return formatExactCurrency(fixed, formatter, locale, options.currencyDisplay);
}
