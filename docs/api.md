# API reference

Country utility and UI core exports are also available from their corresponding subpaths; `createGlobalConfig` is the country-bound root client. Financial, project-check and runtime adapters have separate entries listed below. Invalid runtime configuration throws `TypeError` or `RangeError`; async currency adapters propagate provider errors. Returned money amounts are decimal strings.

## Country API (`glocon/countries`)

| Export | Purpose |
| --- | --- |
| `countries` | Immutable `IN`, `US`, `JP` configuration map |
| `resolveCountry(string)` | Normalize a country code/name alias to `CountryCode` |
| `getCountry(string)` | Read an immutable country profile |
| `listCountries()` | List supported profiles |
| `currencyCode(string)` | Validate INR/USD/JPY; currency codes are uppercase |
| `currencyDigits(CurrencyCode)` | Return 2 for INR/USD, 0 for JPY |

## Money API (`glocon/currency`)

| Export | Purpose |
| --- | --- |
| `convertCurrency({ amount, from, to, rates, rounding?, maxAgeMs?, now? })` | Decimal conversion with source and quote timestamp in the result |
| `createCurrencyConverter(provider)` | Async converter using your `Promise<ExchangeRates>` provider |
| `formatCurrency(amount, currency, { locale?, currencyDisplay?, rounding? }?)` | Locale-sensitive currency display |
| `toMinorUnits(amount, currency, rounding?)` | Round to an integer `bigint` |
| `fromMinorUnits(bigintOrIntegerString, currency)` | Convert minor units to a decimal string |

`ExchangeRates` is `{ base, rates, asOf, source }`. A base quote may be omitted; if supplied it must equal 1. All supplied quotes must be positive and supported. The amount is rounded once from the exact rational value `amount × targetQuote / sourceQuote`, without an intermediate rounded Decimal division. The returned `rate` is a finite Decimal approximation for display/metadata; calculate with the original quotes, not that approximation. All own string-key quotes are validated and snapshotted once, including nonenumerable properties; inherited quotes cannot satisfy a missing currency. Same-currency conversions use rate 1. Monetary input supports strings or numbers; use strings for exact values. Freshness boundaries are inclusive: an age equal to `maxAgeMs` passes.

`formatCurrency` detects decimal-string support in `Intl`. Older implementations, including the tested Hermes runtime, retain exact string digits with locale grouping, decimal separators, signs and numeral systems from `formatToParts`. Numeric digits come from the rounded decimal string. `currencyDisplay: 'name'` on such a runtime is limited to safely representable amounts below 2^45, because name grammar may depend on the exact value. Larger names require compatible Intl or symbol/code display and throw instead of losing money precision. Modern Intl retains direct formatting. A 567-case regression matrix covers nine locales, three currencies, signs, bounds, grouping and numeral variants under simulated legacy coercion.

## Time API (`glocon/time`)

| Export | Purpose |
| --- | --- |
| `resolveTimeZone(countryOrIanaZone)` | Resolve a single-zone country or validate an IANA zone |
| `convertTime(instant, to)` | Convert an offset-bearing ISO string, Date, or epoch milliseconds |
| `convertLocalTime(local, { from, to, disambiguation? })` | Resolve a local wall clock, then convert to destination |
| `formatTime(instant, { timeZone, locale?, dateStyle?, timeStyle? })` | Localized date/time display |

Conversion results contain `instant`, `local`, `timeZone`, `offset`, `zoned`, and `epochMilliseconds`. ISO string results preserve nanoseconds; epoch milliseconds and display formatting have millisecond resolution. `disambiguation` defaults to `reject`. No time zone is silently chosen for the USA. Validated slashless IANA aliases such as `GMT`, `CET` and `EST` are accepted; fixed-offset strings such as `+05:30` are not IANA identifiers.

## Tax API (`glocon/tax`)

`calculateTax` requires one of these shapes, plus `amount`, optional `inclusive`, and optional `rounding`:

```ts
{ country: 'IN', rate, supply: 'intra-state' | 'inter-state', localTax?: 'SGST' | 'UTGST' }
{ country: 'US', rate, jurisdiction }
{ country: 'JP', category: 'standard' | 'reduced' }
{ country: 'JP', rate }
```

`localTax` only applies to intra-state supplies. Result fields: `country`, `currency`, `net`, `tax`, `gross`, `rate`, `components`, and `profile`. Tax is rounded once per group at currency precision, except India intra-state `indiaRounding: "components"` (the default), which rounds each half separately and sums them. `indiaRounding: "combined"` preserves the pre-0.7 aggregate policy and allocates the final remainder to local tax. The compliance configuration accepts the same policy; match it across previews and invoices. Inclusive prices preserve the input gross amount. Impossible rounding that would make net negative is rejected. Components sum exactly to tax; net plus tax equals gross. Negative amounts are rejected.

`createTaxManager(initialRules?)` exposes `register(rule)`, `list()`, `getRate(id, on)`, `calculate(options)`, and `progressive(options)`. Rules have unique IDs, source references, a country, a percentage rate, inclusive `effectiveFrom`, and optional exclusive `effectiveTo`. Dates must be valid `YYYY-MM-DD`. `getRate` rejects missing/out-of-period rules; it does not automatically apply a returned rule to a calculation.

```ts
import { calculateProgressiveTax } from 'glocon/tax';

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

## Laws API (`glocon/laws`)

`createLawsManager({ rules?, records? }?)` exposes:

| Method | Purpose |
| --- | --- |
| `list({ country?, topic? }?)` | Filter immutable rules; topics: privacy, children, tax |
| `register(rule)` | Add a unique sourced rule with scoped controls |
| `revision(id)` | Read the content revision used to associate saved assertions with a rule |
| `assess({ country, facts?, on? })` | Produce a dated review report; omitted date uses UTC today |
| `record({ ruleId, controlId, status, note, updatedAt })` | Update a control's latest status |
| `exportRecords()` | Return records suitable for JSON persistence |
| `plan({ country, facts?, on? })` | Get deduplicated questions, source-linked implementation tasks, source-review flags, and recorded progress |

Facts: `collectsPersonalData`, `servesChildrenUnder13`, `ccpaApplies`, `sellsTaxableItems`. Each is boolean or omitted. An explicit false fact takes precedence over missing facts. Controls do not disappear when facts are missing or false. Review statuses: `todo`, `in-progress`, `done`, `not-applicable`; the latter two need evidence/reason notes. Unknown rules, controls, topics, and facts fail validation.

`LawRule` carries `id`, `country`, `title`, `topic`, `jurisdiction`, `summary`, `scope`, `source`, `reviewedOn`, optional `reviewAfter` and `revision`, optional `effectiveFrom` / `effectiveTo`, `timing`, `when` (fact keys combined with AND), and `controls` (unique IDs/titles). Supplied rules replace the built-in catalog. Registering a rule copies its arrays so later caller mutations do not affect the manager. To restore records for custom rules, supply those rules again.

`LawControl` also accepts optional `implementation` and `evidence` string arrays, and an optional HTTPS `source` overriding the rule link. These are implementation suggestions and review artifacts. `appFacts` exposes the question and help text for each supported `AppFact`.

`plan` returns `{ country, on, scope, questions, tasks, sourcesToReview, evidence, progress }`:

- Questions contain `fact`, `question`, `help`, `ruleIds`, and `sources`.
- Tasks contain rule/control IDs, titles, topic, jurisdiction, scope, applicability, timing notes, source and review date, implementation/evidence suggestions, status, and the saved record or `null`.
- Rules with a false condition or an expired declared period are excluded from the plan. Upcoming and undecided rules remain explicitly labelled. Use `assess` to inspect all rule decisions.
- Tasks include `revision`, `recordReviewRequired` and `verification`: `not-recorded`, `recorded-for-revision`, or `review-required`. New records retain `ruleRevision`; unversioned or outdated records keep their status while requiring review.
- Evidence counts `recordedForRevision`, `requiresReview` and `notRecorded`. These are user assertions associated with a revision, not proof of operational behavior.
- Progress counts `total`, `todo`, `inProgress`, `done`, and `notApplicable`. Source-review requirements remain independent of progress. A custom `reviewAfter` defines an exclusive review deadline; without one, the legacy source-date comparison remains conservative.

## Country-bound client (`glocon`)

`createGlobalConfig('IN')` or `createGlobalConfig({ country, locale?, timeZone?, facts?, records? })` exposes:

- `country` and `locale` metadata.
- `currency.format(amount, options?)` with the country's currency and locale; `currency.convert(options)` sets the source currency to the country currency and requires a destination.
- `currency.toMinorUnits(amount, rounding?)` and `currency.fromMinorUnits(bigintOrIntegerString)` use the country's currency precision.
- `time.convert(instant, to?)` and `time.format(instant, timeZone?)` default to the configured zone. `time.fromLocal(local, { to, disambiguation? })` treats the configured zone as the source.
- `tax` manager methods plus the country tax profile. `tax.calculate` fills in `country`; an explicit matching country remains accepted. Known literal country codes/names preserve the country-specific required fields in TypeScript. Mismatched countries are rejected at runtime too.
- `laws` manager methods with `list`, `assess`, and `plan` bound to the country. Saved facts are copied at creation; per-call facts override individual saved answers without changing defaults. Supplied records restore independent in-memory review progress.

Public types include `GlobalConfigOptions`, `GlobalConfig<CountryCode>`, `CountryTaxOptions<CountryCode>`, and `CountryCodeFor<string>`. Known unpadded literal codes and aliases are resolved for autocomplete; dynamically loaded country strings use the broader country union and runtime validation. The standalone `calculateTax` continues to require the discriminating country field.

Country-bound time operations defer the missing-US-zone error until a zone is actually needed. This allows currency or tax clients to be used without an arbitrary US time-zone default.

`toMinorUnits` and `fromMinorUnits` share a magnitude bound below 1e30 in major currency units. An encoding whose rounding carries to that bound is rejected. Every accepted encoded amount can be decoded at the same currency precision. Computed FX amounts, formatted amounts and aggregate tax net/tax/gross amounts share the strict absolute bound below 1e30 after rounding. Raw decimal/integer input strings are limited to 1,024 characters before parsing, including insignificant zeros.

## Workflow and adapter entries

| Import | Public workflow | Reference |
| --- | --- | --- |
| `glocon/compliance` | Configuration validation, order calculation, registered-engine replay, invoice/credit drafts, locks and financial acceptance | [Financial API and limits](compliance/README.md#library-api) |
| `glocon/compliance/server` | Synchronous SQLite numbering, idempotency and complete cumulative-credit checks | [Store integration](compliance/README.md#persistence-and-retry-safe-server-integration) |
| `glocon/compliance/sources` | Explicit bounded source-byte retrieval and destination-aware baseline comparisons | [Source checks](compliance/README.md#rule-locks-replay-and-source-checks) |
| `glocon/check` | `defineCheckConfig`, `runChecks`, reports, authored scenarios and project baselines; Node only | [Project API](ui/project-checks.md#programmatic-use-nodejs) |
| `glocon/ui` | `auditSnapshot`, contracts, report creation/formatting, fingerprints, rules and failure thresholds | [UI contracts](ui/README.md#test-ui-that-should-exist) |
| `glocon/browser` | Synchronous light-DOM collection and layout/UX auditing | [Browser adapter](ui/integrations.md#browser-only-checks) |
| `glocon/playwright` | `auditPage`, `auditStates`, `assertUI` and `matchers`; optional Playwright/axe peers | [Playwright integration](ui/README.md#use-your-existing-playwright-tests) |
| `glocon/react` | `Button`, `Field`, `Status`, `EmptyState`, `AsyncState`, `Stack` and their props | [React primitives](ui/README.md#prevent-common-omissions-with-react-primitives) |
| `glocon/native` | `fromNativeNodes`, `auditNative` and measured-node types | [Native adapter](ui/integrations.md#react-native--expo) |

The financial APIs return discriminated `Result<T>` values; branch on `ready`, `needs-context`, `unsupported` and `invalid`. Store operations throw for rejected requests or conflicting idempotency inputs. Pure UI report/contract entry points validate runtime options for JavaScript callers; invalid severities, thresholds, measurements or coverage policy fail validation instead of becoming passing reports. Consumer runtimes require Node.js 20.3+ where Node is used; repository tooling requires 20.11+.
