# globalconfig

**Build for more countries with less configuration.**

Currency, time zones, taxes, and legal review workflows behind one TypeScript API. Start with **India, the United States, and Japan**. Use it in a checkout, scheduling service, SaaS backend, or a browser app through your bundler.

[![CI](https://github.com/lastlandofficial/globalconfig/actions/workflows/ci.yml/badge.svg)](https://github.com/lastlandofficial/globalconfig/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install now — no registry account needed

The prebuilt GitHub release is public. Choose your package manager:

```sh
npm install https://github.com/lastlandofficial/globalconfig/releases/download/v0.1.0/globalconfig-0.1.0.tgz
pnpm add https://github.com/lastlandofficial/globalconfig/releases/download/v0.1.0/globalconfig-0.1.0.tgz
yarn add https://github.com/lastlandofficial/globalconfig/releases/download/v0.1.0/globalconfig-0.1.0.tgz
bun add https://github.com/lastlandofficial/globalconfig/releases/download/v0.1.0/globalconfig-0.1.0.tgz
```

Imports use `globalconfig` regardless of the installation URL. Consumers do not need credentials, build tools, or install scripts. Use a release tarball instead of the source repository URL: compiled files live in release assets.

**npm registry publication is pending.** Once published, the shorter commands will be `npm install globalconfig`, `pnpm add globalconfig`, `yarn add globalconfig`, and `bun add globalconfig`. These package managers share the npm registry; there is no separate Bun or pnpm publication step. See [publishing](docs/publishing.md).

## One client, country defaults

```ts
import { createGlobalConfig } from 'globalconfig';

const india = createGlobalConfig({ country: 'IN' });

india.currency.format('123456.78'); // ₹1,23,456.78
india.time.convert('2026-09-01T12:00:00Z');
// { local: '2026-09-01T17:30:00', offset: '+05:30', ... }

india.tax.calculate({
  country: 'IN', amount: '1000', rate: '18', supply: 'intra-state',
});
// net: '1000.00', tax: '180.00', gross: '1180.00'
// CGST: '90.00', SGST: '90.00'

const review = india.laws.assess({
  facts: { collectsPersonalData: true, sellsTaxableItems: true },
});
// Source-linked controls, applicability questions, dates, and review progress.
```

Tax and law helpers support implementation and review. They do not certify an application's compliance. The first release covers indirect-tax arithmetic and selected privacy/tax checklists, not every law or tax in a country. Check the [coverage and sources](docs/coverage.md) before using these features.

## What is included

| Module | Capabilities |
| --- | --- |
| Countries | Immutable profiles, aliases, currency, locale presets, calling codes, IANA zones |
| Currency | Decimal calculations, cross rates, freshness checks, formatting, minor units, async provider adapter |
| Time | Instant and wall-clock conversion, DST ambiguity handling, localized display |
| Tax | India GST split, explicit US combined sales tax, Japan consumption tax, inclusive prices, custom marginal schedules, dated rate registry |
| Laws | Selected India DPDP, US CCPA/COPPA, Japan APPI, and tax review checklists; custom rules; evidence notes; import/export of progress |

| Country | Code / aliases | Currency | Default locale | Time zone |
| --- | --- | --- | --- | --- |
| India | `IN`, `IND`, `India` | INR, 2 decimal places | `en-IN` | `Asia/Kolkata` |
| United States | `US`, `USA`, `United States` | USD, 2 decimal places | `en-US` | Explicit IANA zone required |
| Japan | `JP`, `JPN`, `Japan` | JPY, 0 decimal places | `ja-JP` | `Asia/Tokyo` |

## Currency conversion

Supply rates from your preferred provider. Every quote means **units of currency per one base unit**. There are no bundled market rates or automatic network calls.

```ts
import { convertCurrency, toMinorUnits, fromMinorUnits } from 'globalconfig/currency';

const result = convertCurrency({
  amount: '100', from: 'USD', to: 'JPY',
  rates: {
    base: 'USD',
    rates: { INR: '83.25', JPY: '150' }, // Illustrative fixtures, not market data
    asOf: '2026-09-01T00:00:00Z',
    source: 'Example rates',
  },
  maxAgeMs: 60_000,
  now: new Date('2026-09-01T00:00:30Z'), // Omit to use the actual current time
});
// result.amount === '15000'; result includes rate, source, and asOf

toMinorUnits('10.25', 'USD');  // 1025n
fromMinorUnits(1025n, 'USD'); // '10.25'
```

Prefer decimal strings for money. Results are strings; minor-unit helpers use `bigint`. Inputs must be finite, have magnitude below `1e30`, and have no more than 18 decimal places. Numeric inputs cannot recover precision already lost in JavaScript. Supported rounding: `half-up` (default), `half-even`, `down` (toward zero), and `up` (away from zero). Convert `bigint` to a string before JSON serialization.

Use `createCurrencyConverter(async () => rates)` to connect a bank API, FX vendor, or your own cache. The adapter runs once per call; caching, retries, credentials, and rate refresh are owned by your app. Pass `maxAgeMs` to reject stale or future-dated quotes; freshness checking is opt-in.

## Time conversion

```ts
import { convertTime, convertLocalTime } from 'globalconfig/time';

convertTime('2026-09-01T12:00:00Z', 'JP');
// local: '2026-09-01T21:00:00', offset: '+09:00'

convertLocalTime('2026-09-01T09:00', {
  from: 'America/New_York', to: 'IN',
});
// local: '2026-09-01T18:30:00'

convertLocalTime('2026-11-01T01:30', {
  from: 'America/New_York', to: 'JP', disambiguation: 'later',
});
```

`convertTime` accepts an ISO instant with an offset, `Date`, or epoch milliseconds. `convertLocalTime` accepts an offset-free local date and time and **rejects DST gaps and overlaps by default**. Set `earlier`, `later`, or `compatible` deliberately when needed. Country aliases work for India/Japan; `US` requires a zone. Explicit IANA zones, including zones outside these three country profiles, are supported by the time utility. Zone rules come from the runtime's ICU/time-zone data via Temporal.

## Tax calculations

```ts
import { calculateTax, createTaxManager } from 'globalconfig/tax';

calculateTax({ country: 'US', amount: '100', rate: '8.875', jurisdiction: 'Example district' });
// tax: '8.88', gross: '108.88' — example rate, not a location lookup

calculateTax({ country: 'JP', amount: '1080', category: 'reduced', inclusive: true });
// net: '1000', tax: '80', gross: '1080'

const taxes = createTaxManager([{
  id: 'my-verified-supply-2026', country: 'IN', rate: '18',
  effectiveFrom: '2026-01-01', effectiveTo: '2027-01-01',
  source: 'Your verified classification and notification reference',
}]);
const rule = taxes.getRate('my-verified-supply-2026', '2026-09-01');
taxes.calculate({ country: rule.country as 'IN', amount: '1000', rate: rule.rate, supply: 'inter-state' });
```

Rates use percentages: `18` means 18%. Tax amounts must be non-negative and in whole currency minor units. India requires a verified combined rate plus a supply type; intra-state splits support `SGST` or `UTGST`. An odd minor-unit remainder is allocated to the local component so totals reconcile. This is an allocation policy, not statutory return rounding. US calls require a combined rate and jurisdiction; the package does not infer nexus, addresses, exemptions, or product taxability. Japan categories use the NTA's 10% standard and 8% reduced rates; eligibility is the caller's responsibility.

Aggregate amounts at the legally appropriate invoice/rate level before calling. For Japan qualified invoices, aggregate by rate and round once; choose the applicable rounding policy. Do not calculate every line independently and assume the sum is a compliant invoice total. Refunds, credit-note treatment, cess, filing calculations, and tax remittance are outside this API.

`calculateProgressiveTax({ taxableIncome, currency, brackets })` applies your supplied marginal schedule. Brackets use `{ upTo, rate }`, increasing upper bounds, and a final `upTo: null`. It does not embed personal income-tax schedules, deductions, rebates, or surcharges. See [API reference](docs/api.md).

## Legal review workflow

```ts
import { createLawsManager } from 'globalconfig/laws';

const laws = createLawsManager();
const report = laws.assess({
  country: 'US',
  facts: {
    collectsPersonalData: true,
    ccpaApplies: true, // Set after reviewing statutory scope and thresholds
    servesChildrenUnder13: false,
  },
});

laws.record({
  ruleId: 'us-ccpa', controlId: 'notices', status: 'done',
  note: 'Notice reviewed; evidence in issue #42',
  updatedAt: new Date().toISOString(),
});

const saved = JSON.stringify(laws.exportRecords());
const restored = createLawsManager({ records: JSON.parse(saved) });
```

Missing facts remain `needs-context`; they are not silently treated as false. A match is `review-required`; a false fact produces `not-indicated`, not a legal exemption finding. Timing, source-review dates, and control status are separate. India DPDP entries explicitly require a provision-by-provision commencement review. `done` and `not-applicable` require a note. Records are kept in memory; persist them yourself. The latest record per control is exported, not an immutable audit log. Marking a checklist complete never produces a “legally compliant” certification.

Use `register(rule)` to add your own sourced rules. `createLawsManager({ rules })` replaces the bundled catalog, allowing an organization to maintain an independently reviewed rule set.

## JavaScript, TypeScript, and runtimes

ESM, CommonJS, and declarations are included. Subpath imports avoid bringing unrelated modules into application bundles.

```js
const { createGlobalConfig } = require('globalconfig');
const japan = createGlobalConfig({ country: 'JP' });
```

Node.js 20+ and Bun are supported. Browser apps need a modern runtime with `Intl` and `BigInt`, plus a bundler that resolves npm imports; use a full ICU runtime for locale and time-zone coverage. No framework, DOM, environment variable, or server process is required by the library. React/Next.js, Vue/Nuxt, Svelte, Express, and other JavaScript apps can use the same API.

## Develop

```sh
npm ci
npm run check
npm run example
npm pack
```

`check` runs strict TypeScript checks, behavior tests, a clean tarball install, ESM/CommonJS checks, and TypeScript consumer tests. CI tests Node.js 20/22/24 and install compatibility with npm, pnpm, Yarn, and Bun. See [contributing](CONTRIBUTING.md).

MIT © Last Land
