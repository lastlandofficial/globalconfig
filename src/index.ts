import { getCountry } from './countries';
import { convertCurrency, formatCurrency } from './currency';
import type { Amount, ConversionOptions, MoneyFormatOptions } from './currency';
import { convertLocalTime, convertTime, formatTime, resolveTimeZone } from './time';
import type { InstantInput } from './time';
import { calculateTax, createTaxManager, taxProfiles } from './tax';
import type { TaxOptions } from './tax';
import { createLawsManager } from './laws';

export * from './countries';
export * from './currency';
export * from './time';
export * from './tax';
export * from './laws';

/** Bind locale and currency defaults once; US time operations still require a time zone. */
export function createGlobalConfig(options: { country: string; locale?: string; timeZone?: string }) {
  const country = getCountry(options.country);
  const locale = options.locale ?? country.locale;
  new Intl.NumberFormat(locale); // Fail early on malformed locales.
  const destination = options.timeZone ?? country.code;
  if (options.timeZone !== undefined) resolveTimeZone(options.timeZone);
  const laws = createLawsManager();
  const taxManager = createTaxManager();
  return Object.freeze({
    country, locale,
    currency: Object.freeze({
      format: (amount: Amount, formatOptions: MoneyFormatOptions = {}) => formatCurrency(amount, country.currency, { locale, ...formatOptions }),
      convert: (input: Omit<ConversionOptions, 'from'>) => convertCurrency({ ...input, from: country.currency }),
    }),
    time: Object.freeze({
      convert: (value: InstantInput, to: string = destination) => convertTime(value, to),
      fromLocal: (value: string, input: Omit<Parameters<typeof convertLocalTime>[1], 'from'>) => convertLocalTime(value, { ...input, from: destination }),
      format: (value: InstantInput, timeZone: string = destination) => formatTime(value, { locale, timeZone }),
    }),
    tax: Object.freeze({
      ...taxManager,
      profile: taxProfiles[country.code],
      calculate(input: TaxOptions) {
        if (input.country !== country.code) throw new RangeError(`This client is configured for ${country.code}`);
        return calculateTax(input);
      },
    }),
    laws: Object.freeze({
      ...laws,
      assess: (input: Omit<Parameters<typeof laws.assess>[0], 'country'> = {}) => laws.assess({ ...input, country: country.code }),
      list: (filter: Omit<Parameters<typeof laws.list>[0], 'country'> = {}) => laws.list({ ...filter, country: country.code }),
    }),
  });
}
