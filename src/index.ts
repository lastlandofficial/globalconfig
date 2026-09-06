import { getCountry } from './countries';
import type { CountryCode, CountryCodeFor, CountryConfig } from './countries';
import { convertCurrency, formatCurrency, fromMinorUnits, toMinorUnits } from './currency';
import type { Amount, ConversionOptions, MoneyFormatOptions, RoundingMode } from './currency';
import { convertLocalTime, convertTime, formatTime, resolveTimeZone } from './time';
import type { InstantInput } from './time';
import { calculateTax, createTaxManager, taxProfiles } from './tax';
import type { TaxOptions, TaxResult } from './tax';
import { createLawsManager } from './laws';
import type { AppContext, ControlRecord } from './laws';

export * from './countries';
export * from './currency';
export * from './time';
export * from './tax';
export * from './laws';

export interface GlobalConfigOptions<Country extends string = string> {
  country: Country;
  locale?: string;
  timeZone?: string;
  /** Saved application facts; per-call facts can override individual answers. */
  facts?: AppContext['facts'];
  /** Restore previously recorded review work from your own storage. */
  records?: readonly ControlRecord[];
}

type WithOptionalCountry<Options> = Options extends { country: CountryCode }
  ? Omit<Options, 'country'> & { country?: Options['country'] }
  : never;

/** Country comes from the client; all other country-specific tax fields stay required. */
export type CountryTaxOptions<Country extends CountryCode = CountryCode> = WithOptionalCountry<Extract<TaxOptions, { country: Country }>>;

export type GlobalConfig<Country extends CountryCode = CountryCode> = Omit<ReturnType<typeof createClient>, 'country' | 'tax'> & {
  readonly country: Readonly<CountryConfig> & { readonly code: Country };
  readonly tax: Omit<ReturnType<typeof createClient>['tax'], 'calculate'> & {
    calculate(input: CountryTaxOptions<Country>): TaxResult;
  };
};

/**
 * Configure a country once with `createGlobalConfig('IN')` or an options object.
 * US time operations still require an explicit time zone.
 */
export function createGlobalConfig<const Country extends string>(options: Country | GlobalConfigOptions<Country>): GlobalConfig<CountryCodeFor<Country>>;
export function createGlobalConfig(options: string | GlobalConfigOptions): GlobalConfig {
  if (options === null || (typeof options !== 'string' && typeof options !== 'object')) {
    throw new TypeError("Pass a country such as 'IN' or an options object with country");
  }
  return createClient(typeof options === 'string' ? { country: options } : options);
}

function createClient(options: GlobalConfigOptions) {
  const country = getCountry(options.country);
  const locale = options.locale ?? country.locale;
  new Intl.NumberFormat(locale); // Fail early on malformed locales.
  const destination = options.timeZone ?? country.code;
  if (options.timeZone !== undefined) resolveTimeZone(options.timeZone);
  const laws = createLawsManager({ records: options.records ?? [] });
  // Validate and copy supplied facts so later caller mutations do not change this client.
  laws.assess({ country: country.code, ...(options.facts === undefined ? {} : { facts: options.facts }) });
  const facts = { ...options.facts };
  const withFacts = (input: Omit<AppContext, 'country'>) => {
    if (input.facts !== undefined && (!input.facts || typeof input.facts !== 'object' || Array.isArray(input.facts))) throw new TypeError('App facts must be an object of boolean answers');
    return { ...input, country: country.code, facts: { ...facts, ...input.facts } };
  };
  const taxManager = createTaxManager();
  return Object.freeze({
    country, locale,
    currency: Object.freeze({
      format: (amount: Amount, formatOptions: MoneyFormatOptions = {}) => formatCurrency(amount, country.currency, { locale, ...formatOptions }),
      convert: (input: Omit<ConversionOptions, 'from'>) => convertCurrency({ ...input, from: country.currency }),
      /** Convert to the country's integer minor units, such as paise, cents, or yen. */
      toMinorUnits: (amount: Amount, mode: RoundingMode = 'half-up') => toMinorUnits(amount, country.currency, mode),
      /** Convert integer minor units back to a decimal string. */
      fromMinorUnits: (amount: bigint | string) => fromMinorUnits(amount, country.currency),
    }),
    time: Object.freeze({
      convert: (value: InstantInput, to: string = destination) => convertTime(value, to),
      fromLocal: (value: string, input: Omit<Parameters<typeof convertLocalTime>[1], 'from'>) => convertLocalTime(value, { ...input, from: destination }),
      format: (value: InstantInput, timeZone: string = destination) => formatTime(value, { locale, timeZone }),
    }),
    tax: Object.freeze({
      ...taxManager,
      profile: taxProfiles[country.code],
      calculate(input: CountryTaxOptions) {
        if (input.country !== undefined && input.country !== country.code) throw new RangeError(`This client is configured for ${country.code}`);
        return calculateTax({ ...input, country: country.code } as TaxOptions);
      },
    }),
    laws: Object.freeze({
      ...laws,
      assess: (input: Omit<AppContext, 'country'> = {}) => laws.assess(withFacts(input)),
      plan: (input: Omit<AppContext, 'country'> = {}) => laws.plan(withFacts(input)),
      list: (filter: Omit<Parameters<typeof laws.list>[0], 'country'> = {}) => laws.list({ ...filter, country: country.code }),
    }),
  });
}

export * from './ui/index';
