# API reference

All root exports are also available from the corresponding subpath. Invalid runtime configuration throws `TypeError` or `RangeError`; async currency adapters propagate provider errors. Returned money amounts are decimal strings.

## Country API (`globalconfig/countries`)

| Export | Purpose |
| --- | --- |
| `countries` | Immutable `IN`, `US`, `JP` configuration map |
| `resolveCountry(string)` | Normalize a country code/name alias to `CountryCode` |
| `getCountry(string)` | Read an immutable country profile |
| `listCountries()` | List supported profiles |
| `currencyCode(string)` | Validate INR/USD/JPY; currency codes are uppercase |
| `currencyDigits(CurrencyCode)` | Return 2 for INR/USD, 0 for JPY |

## Money API (`globalconfig/currency`)

| Export | Purpose |
| --- | --- |
| `convertCurrency({ amount, from, to, rates, rounding?, maxAgeMs?, now? })` | Decimal conversion with source and quote timestamp in the result |
| `createCurrencyConverter(provider)` | Async converter using your `Promise<ExchangeRates>` provider |
| `formatCurrency(amount, currency, { locale?, currencyDisplay?, rounding? }?)` | Locale-sensitive currency display |
| `toMinorUnits(amount, currency, rounding?)` | Round to an integer `bigint` |
| `fromMinorUnits(bigintOrIntegerString, currency)` | Convert minor units to a decimal string |

`ExchangeRates` is `{ base, rates, asOf, source }`. A base quote may be omitted; if supplied it must equal 1. All supplied quotes must be positive and supported. Cross rate = `targetQuote / sourceQuote`. Same-currency conversions use rate 1. Monetary input supports strings or numbers; use strings for exact values. Freshness boundaries are inclusive: an age equal to `maxAgeMs` passes.

## Time API (`globalconfig/time`)

| Export | Purpose |
| --- | --- |
| `resolveTimeZone(countryOrIanaZone)` | Resolve a single-zone country or validate an IANA zone |
| `convertTime(instant, to)` | Convert an offset-bearing ISO string, Date, or epoch milliseconds |
| `convertLocalTime(local, { from, to, disambiguation? })` | Resolve a local wall clock, then convert to destination |
| `formatTime(instant, { timeZone, locale?, dateStyle?, timeStyle? })` | Localized date/time display |

Conversion results contain `instant`, `local`, `timeZone`, `offset`, `zoned`, and `epochMilliseconds`. ISO string results preserve nanoseconds; epoch milliseconds and display formatting have millisecond resolution. `disambiguation` defaults to `reject`. No time zone is silently chosen for the USA.

## Tax API (`globalconfig/tax`)

`calculateTax` requires one of these shapes, plus `amount`, optional `inclusive`, and optional `rounding`:

```ts
{ country: 'IN', rate, supply: 'intra-state' | 'inter-state', localTax?: 'SGST' | 'UTGST' }
{ country: 'US', rate, jurisdiction }
{ country: 'JP', category: 'standard' | 'reduced' }
{ country: 'JP', rate }
```

`localTax` only applies to intra-state supplies. Result fields: `country`, `currency`, `net`, `tax`, `gross`, `rate`, `components`, and `profile`. Tax is rounded once at currency precision; inclusive prices preserve the input gross amount. Components sum exactly to tax; net plus tax equals gross. Negative amounts are rejected.

`createTaxManager(initialRules?)` exposes `register(rule)`, `list()`, `getRate(id, on)`, `calculate(options)`, and `progressive(options)`. Rules have unique IDs, source references, a country, a percentage rate, inclusive `effectiveFrom`, and optional exclusive `effectiveTo`. Dates must be valid `YYYY-MM-DD`. `getRate` rejects missing/out-of-period rules; it does not automatically apply a returned rule to a calculation.

```ts
import { calculateProgressiveTax } from 'globalconfig/tax';

// Fictional marginal schedule, not a country's statutory income tax table.
calculateProgressiveTax({
  taxableIncome: '30000', currency: 'USD',
  brackets: [
    { upTo: '10000', rate: 0 },
    { upTo: '20000', rate: 10 },
    { upTo: null, rate: 20 },
  ],
});
// tax: '3000.00', effectiveRate: '10.0000', plus unrounded bracket details
```

The progressive calculation rounds only the final sum. `breakdown[].unroundedTax` preserves each bracket's unrounded amount; those fields are not independently rounded invoice components. Taxable income must use whole currency minor units.

## Laws API (`globalconfig/laws`)

`createLawsManager({ rules?, records? }?)` exposes:

| Method | Purpose |
| --- | --- |
| `list({ country?, topic? }?)` | Filter immutable rules; topics: privacy, children, tax |
| `register(rule)` | Add a unique sourced rule with scoped controls |
| `assess({ country, facts?, on? })` | Produce a dated review report; omitted date uses UTC today |
| `record({ ruleId, controlId, status, note, updatedAt })` | Update a control's latest status |
| `exportRecords()` | Return records suitable for JSON persistence |

Facts: `collectsPersonalData`, `servesChildrenUnder13`, `ccpaApplies`, `sellsTaxableItems`. Each is boolean or omitted. An explicit false fact takes precedence over missing facts. Controls do not disappear when facts are missing or false. Review statuses: `todo`, `in-progress`, `done`, `not-applicable`; the latter two need evidence/reason notes. Unknown rules, controls, topics, and facts fail validation.

`LawRule` carries `id`, `country`, `title`, `topic`, `jurisdiction`, `summary`, `scope`, `source`, `reviewedOn`, optional `effectiveFrom` / `effectiveTo`, `timing`, `when` (fact keys combined with AND), and `controls` (unique IDs/titles). Supplied rules replace the built-in catalog. Registering a rule copies its arrays so later caller mutations do not affect the manager. To restore records for custom rules, supply those rules again.

## Country-bound client (`globalconfig`)

`createGlobalConfig({ country, locale?, timeZone? })` exposes:

- `country` and `locale` metadata.
- `currency.format(amount, options?)` with the country's currency and locale; `currency.convert(options)` sets the source currency to the country currency and requires a destination.
- `time.convert(instant, to?)` and `time.format(instant, timeZone?)` default to the configured zone. `time.fromLocal(local, { to, disambiguation? })` treats the configured zone as the source.
- `tax` manager methods plus the country tax profile. `tax.calculate` keeps the discriminated `country` input and rejects a different country, preserving TypeScript's country-specific required fields.
- `laws` manager methods with `list` and `assess` bound to the country. Each client owns independent in-memory progress.

Country-bound time operations defer the missing-US-zone error until a zone is actually needed. This allows currency or tax clients to be used without an arbitrary US time-zone default.
