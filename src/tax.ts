import { getCountry } from './countries';
import type { CountryCode, CurrencyCode } from './countries';
import { currencyDigits } from './countries';
import { D, dateOnly, freeze, nonNegative, percent, rounding } from './internal';
import type { Amount, RoundingMode } from './internal';

export interface TaxProfile {
  readonly country: CountryCode;
  readonly system: string;
  readonly guidance: string;
  readonly source: string;
  readonly reviewedOn: string;
}
export const taxProfiles: Readonly<Record<CountryCode, TaxProfile>> = freeze({
  IN: { country: 'IN', system: 'GST', guidance: 'Supply a verified combined GST rate and intra-state or inter-state treatment. Classification, place of supply, cess, exemptions, and registration are external decisions.', source: 'https://taxinformation.cbic.gov.in/', reviewedOn: '2026-09-06' },
  US: { country: 'US', system: 'Sales and use tax', guidance: 'Supply the combined applicable state/local rate and jurisdiction. Nexus, sourcing, product taxability, and exemptions require separate determination.', source: 'https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm', reviewedOn: '2026-09-06' },
  JP: { country: 'JP', system: 'Consumption tax', guidance: 'Choose standard (10%), reduced (8%), or an explicit rate. Determine eligibility and registration separately. Aggregate by rate per invoice before rounding.', source: 'https://www.nta.go.jp/english/taxes/consumption_tax/01.htm', reviewedOn: '2026-09-06' },
});

interface TaxBase {
  amount: Amount;
  inclusive?: boolean;
  rounding?: RoundingMode;
}
export type TaxOptions = TaxBase & (
  | { country: 'IN'; rate: Amount; supply: 'intra-state' | 'inter-state'; localTax?: 'SGST' | 'UTGST' }
  | { country: 'US'; rate: Amount; jurisdiction: string }
  | { country: 'JP'; category: 'standard' | 'reduced'; rate?: never }
  | { country: 'JP'; category?: never; rate: Amount }
);
export interface TaxResult {
  readonly country: CountryCode;
  readonly currency: CurrencyCode;
  readonly net: string;
  readonly tax: string;
  readonly gross: string;
  readonly rate: string;
  readonly components: readonly { readonly name: string; readonly rate: string; readonly amount: string }[];
  readonly profile: TaxProfile;
}

/** Arithmetic for a caller-classified taxable amount. Rates are percentages, not fractions. */
export function calculateTax(options: TaxOptions): TaxResult {
  const country = getCountry(options.country);
  if (country.code !== options.country) throw new RangeError('Tax country must be IN, US, or JP');
  if (options.inclusive !== undefined && typeof options.inclusive !== 'boolean') throw new TypeError('inclusive must be a boolean');
  const digits = currencyDigits(country.currency);
  const mode = rounding(options.rounding);
  const amount = nonNegative(options.amount, 'amount');
  if (amount.decimalPlaces() > digits) throw new RangeError(`Tax amount must be in whole ${country.currency} minor units; aggregate and round the taxable base first`);
  let rate;
  if (options.country === 'JP' && options.category !== undefined) {
    if (options.category !== 'standard' && options.category !== 'reduced') throw new RangeError('Unknown Japan tax category');
    if (options.rate !== undefined) throw new TypeError('Choose a Japan category or an explicit rate, not both');
    rate = new D(options.category === 'standard' ? 10 : 8);
  } else {
    rate = percent(options.rate!);
  }
  const factor = rate.div(100).plus(1);
  const tax = (options.inclusive ? amount.minus(amount.div(factor)) : amount.mul(rate).div(100)).toDecimalPlaces(digits, mode);
  const net = options.inclusive ? amount.minus(tax) : amount;
  const gross = options.inclusive ? amount : net.plus(tax);
  const components: { name: string; rate: string; amount: string }[] = [];
  if (options.country === 'IN') {
    if (options.supply !== 'intra-state' && options.supply !== 'inter-state') throw new RangeError('India requires intra-state or inter-state supply');
    if (options.localTax !== undefined && options.localTax !== 'SGST' && options.localTax !== 'UTGST') throw new RangeError('localTax must be SGST or UTGST');
    if (options.supply === 'inter-state') {
      if (options.localTax !== undefined) throw new RangeError('localTax applies only to intra-state supplies');
      components.push({ name: 'IGST', rate: rate.toString(), amount: tax.toFixed(digits) });
    } else {
      // Allocate the final minor-unit remainder to local tax so components always reconcile.
      const central = tax.div(2).toDecimalPlaces(digits, mode);
      components.push({ name: 'CGST', rate: rate.div(2).toString(), amount: central.toFixed(digits) }, { name: options.localTax ?? 'SGST', rate: rate.div(2).toString(), amount: tax.minus(central).toFixed(digits) });
    }
  } else if (options.country === 'US') {
    if (typeof options.jurisdiction !== 'string' || !options.jurisdiction.trim()) throw new TypeError('US sales tax requires a jurisdiction');
    components.push({ name: options.jurisdiction.trim(), rate: rate.toString(), amount: tax.toFixed(digits) });
  } else {
    components.push({ name: 'Consumption tax (national + local)', rate: rate.toString(), amount: tax.toFixed(digits) });
  }
  return freeze({ country: country.code, currency: country.currency, net: net.toFixed(digits), tax: tax.toFixed(digits), gross: gross.toFixed(digits), rate: rate.toString(), components, profile: taxProfiles[country.code] });
}

export interface TaxBracket { readonly upTo: Amount | null; readonly rate: Amount }
/** Apply a caller-supplied marginal schedule to taxable income, excluding deductions/surcharges. */
export function calculateProgressiveTax(options: { taxableIncome: Amount; currency: CurrencyCode; brackets: readonly TaxBracket[]; rounding?: RoundingMode }) {
  const income = nonNegative(options.taxableIncome, 'taxable income');
  const digits = currencyDigits(options.currency);
  const mode = rounding(options.rounding);
  if (income.decimalPlaces() > digits) throw new RangeError('Taxable income must be in whole currency minor units');
  if (!Array.isArray(options.brackets) || options.brackets.length === 0 || options.brackets.at(-1)?.upTo !== null) throw new RangeError('Brackets must end with an unbounded upTo: null bracket');
  let lower = new D(0);
  let total = new D(0);
  const breakdown = options.brackets.map((bracket, index) => {
    const rate = percent(bracket.rate);
    if (bracket.upTo === null && index !== options.brackets.length - 1) throw new RangeError('Only the final bracket may be unbounded');
    const upper = bracket.upTo === null ? null : nonNegative(bracket.upTo, 'bracket upper bound');
    if (upper && upper.lte(lower)) throw new RangeError('Bracket upper bounds must be strictly increasing');
    const taxable = D.max(0, D.min(income, upper ?? income).minus(lower));
    const tax = taxable.mul(rate).div(100);
    total = total.plus(tax);
    const row = { from: lower.toString(), upTo: upper?.toString() ?? null, rate: rate.toString(), taxable: taxable.toString(), unroundedTax: tax.toString() };
    if (upper) lower = upper;
    return row;
  });
  return freeze({ currency: options.currency, taxableIncome: income.toFixed(digits, mode), tax: total.toFixed(digits, mode), effectiveRate: income.isZero() ? '0' : total.div(income).mul(100).toFixed(4), breakdown });
}

export interface TaxRateRule {
  readonly id: string;
  readonly country: CountryCode;
  readonly rate: Amount;
  readonly effectiveFrom: string;
  /** Exclusive end date. */
  readonly effectiveTo?: string;
  readonly source: string;
}
/** Version your own verified rates without relying on a permanently bundled rate table. */
export function createTaxManager(initial: readonly TaxRateRule[] = []) {
  const rules = new Map<string, TaxRateRule>();
  const register = (rule: TaxRateRule) => {
    if (!rule.id?.trim() || !rule.source?.trim()) throw new TypeError('Tax rule id and source are required');
    if (rules.has(rule.id)) throw new RangeError(`Duplicate tax rule: ${rule.id}`);
    if (getCountry(rule.country).code !== rule.country) throw new RangeError('Tax rule country must be IN, US, or JP');
    percent(rule.rate); dateOnly(rule.effectiveFrom);
    if (rule.effectiveTo !== undefined && dateOnly(rule.effectiveTo) <= rule.effectiveFrom) throw new RangeError('effectiveTo must follow effectiveFrom');
    rules.set(rule.id, freeze({ ...rule }));
  };
  initial.forEach(register);
  return Object.freeze({
    register,
    list: () => Object.freeze([...rules.values()]),
    getRate(id: string, on: string): TaxRateRule {
      dateOnly(on);
      const rule = rules.get(id);
      if (!rule) throw new RangeError(`Unknown tax rule: ${id}`);
      if (on < rule.effectiveFrom || (rule.effectiveTo && on >= rule.effectiveTo)) throw new RangeError(`Tax rule ${id} is not effective on ${on}`);
      return rule;
    },
    calculate: calculateTax,
    progressive: calculateProgressiveTax,
  });
}
