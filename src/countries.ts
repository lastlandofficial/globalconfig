import { freeze } from './internal';

export type CountryCode = 'IN' | 'US' | 'JP';
export type CurrencyCode = 'INR' | 'USD' | 'JPY';
export interface CountryConfig {
  readonly code: CountryCode;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly locales: readonly string[];
  readonly timeZones: readonly string[];
  readonly minorUnits: number;
  readonly callingCode: string;
}

export const countries: Readonly<Record<CountryCode, CountryConfig>> = freeze({
  IN: { code: 'IN', name: 'India', currency: 'INR', locale: 'en-IN', locales: ['en-IN', 'hi-IN'], timeZones: ['Asia/Kolkata'], minorUnits: 2, callingCode: '+91' },
  US: { code: 'US', name: 'United States', currency: 'USD', locale: 'en-US', locales: ['en-US', 'es-US'], timeZones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Adak', 'Pacific/Honolulu', 'America/Detroit', 'America/Indiana/Indianapolis', 'America/Indiana/Knox', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Tell_City', 'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Menominee', 'America/North_Dakota/Beulah', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/Boise', 'America/Juneau', 'America/Metlakatla', 'America/Nome', 'America/Sitka', 'America/Yakutat'], minorUnits: 2, callingCode: '+1' },
  JP: { code: 'JP', name: 'Japan', currency: 'JPY', locale: 'ja-JP', locales: ['ja-JP'], timeZones: ['Asia/Tokyo'], minorUnits: 0, callingCode: '+81' },
});

const aliases: Readonly<Record<string, CountryCode>> = { IN: 'IN', IND: 'IN', INDIA: 'IN', US: 'US', USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', JP: 'JP', JPN: 'JP', JAPAN: 'JP' };

export function resolveCountry(input: string): CountryCode {
  if (typeof input !== 'string') throw new TypeError('country must be a string');
  const key = input.trim().toUpperCase();
  if (!Object.hasOwn(aliases, key)) throw new RangeError(`Unsupported country: ${input}. Supported: IN, US, JP`);
  return aliases[key]!;
}

export function getCountry(input: string): CountryConfig { return countries[resolveCountry(input)]; }
export function listCountries(): readonly CountryConfig[] { return Object.freeze(Object.values(countries)); }

export function currencyCode(input: string): CurrencyCode {
  if (input !== 'INR' && input !== 'USD' && input !== 'JPY') throw new RangeError(`Unsupported currency: ${input}`);
  return input;
}

export function currencyDigits(input: CurrencyCode): number { return currencyCode(input) === 'JPY' ? 0 : 2; }
