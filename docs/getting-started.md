# Getting started with globalconfig

The project is **globalconfig**. Its npm package and terminal command are **glocon**.

## Install in an existing TypeScript or JavaScript app

```sh
npm install glocon
```

```ts
import { createGlobalConfig } from 'glocon';

const app = createGlobalConfig('IN');
const plan = app.laws.plan();
console.log(plan.questions); // Find out what information is missing first.
```

The object form supports `country`, `locale`, `timeZone`, saved `facts`, and saved review `records`. Literal codes and supported names provide country-specific tax autocomplete. Strings loaded dynamically from configuration are validated at runtime.

```ts
const india = createGlobalConfig('India');
india.tax.calculate({ amount: '1000', rate: '18', supply: 'intra-state' });
india.currency.toMinorUnits('10.25'); // 1025n
india.currency.fromMinorUnits('1025'); // '10.25'

const us = createGlobalConfig({ country: 'US', timeZone: 'America/New_York' });
us.time.convert('2026-09-01T12:00:00Z');
us.tax.calculate({ amount: '100', rate: '8.875', jurisdiction: 'Example district' });

const japan = createGlobalConfig('JP');
japan.tax.calculate({ amount: '1000', category: 'standard' });
```

Rates and jurisdictions above are example inputs. Confirm classifications and applicable rates before using tax calculations for a transaction. Currency conversion continues to require rates from your chosen provider.

## Optional project setup command

```sh
npm install -g glocon
glocon init
glocon plan
```

`init` asks for a country, detects npm/pnpm/Yarn/Bun, adds the local dependency, and runs the package manager's install command. It preserves existing scripts and refuses to overwrite any existing setup file.

| Generated file | Purpose |
| --- | --- |
| `glocon.config.json` | Shared country, optional locale/time zone, application facts, and review records |
| `globalconfig.js` | ESM client for frontend bundlers, reading the JSON configuration |
| `globalconfig.d.ts` | TypeScript declarations for that client |
| `globalconfig.cjs` | Node.js client reading the same configuration |
| `globalconfig.d.cts` | TypeScript declarations for the Node.js client |

Existing projects retain their other dependencies and scripts. If it is unused, a `globalconfig:plan` script is added. A failed dependency installation leaves the setup files in place; run your package manager's install command to finish.

```sh
glocon init --country IN --no-install
glocon init --country US --time-zone America/New_York
glocon init --country JP --dir ./my-app --package-manager pnpm
glocon plan --json
glocon plan --on 2026-09-06
```

`--no-install` still adds the dependency to `package.json`, but leaves installation to you. Run `init` in an individual app directory when working in a monorepo. Select `--package-manager` when several lockfiles are present. A review date selects declared rule periods; it does not retrieve a historical legal database.

## Use it in your framework

| Product | Integration |
| --- | --- |
| React / frontend bundlers | `import { globalconfig } from './globalconfig.js'` |
| Next.js | Use the same bundler client where needed; keep private evidence and per-user review state on the server |
| React Native | Use the same bundler client; check `Intl`, locale data, time zones, and `BigInt` on the actual device engine |
| Electron renderer | Use the bundler client without Node integration |
| Electron main / Node.js | ESM: `import globalconfig from './globalconfig.cjs'`; CommonJS: `const globalconfig = require('./globalconfig.cjs')` |

These wrappers share one JSON configuration. The `.js` wrapper expects a bundler that handles JSON imports; use `.cjs` directly in Node.js. The declarations expose the client API in both JavaScript and TypeScript projects. If you prefer no generated files, call `createGlobalConfig` directly from application code.

The generated client is a singleton for project settings. Create separate clients for per-user or per-request review records. Browser bundles can contain imported configuration: keep secrets and private evidence in backend storage, and put only suitable project facts in frontend configuration.

Standalone imports such as `glocon/tax` and `glocon/laws` let an application use just the needed module. Helpers return data; your React state, server routes, consent UI, storage, and background jobs remain application code.

## Answer questions and retain review work

Edit `glocon.config.json` with reviewed boolean facts. Leave unanswered facts out:

```json
{
  "country": "IN",
  "facts": {
    "collectsPersonalData": true,
    "sellsTaxableItems": true
  },
  "records": []
}
```

Run `glocon plan` again. Each task carries implementation suggestions, evidence suggestions, its official source, a review date, and timing/applicability labels. Save progress using `app.laws.record(...)` and persist `app.laws.exportRecords()` in your own storage. The CLI can restore records supplied in the JSON configuration.

## Common setup problems

| Message or symptom | Next step |
| --- | --- |
| Existing setup file | Edit it directly; `init` preserves existing work |
| Country required in a script | Add `--country IN`, `US`, or `JP` |
| US has multiple time zones | Set an IANA `timeZone` before calling time helpers |
| `needs-context` | Answer the corresponding applicability question; unknown is not false |
| `verify-commencement` | Review the linked timing guidance before treating the task as an active obligation |
| Source review required | Recheck the cited authority for the requested date; the package contains bundled data |

See [the government-source workflow](government-workflow.md), [API reference](api.md), and [coverage](coverage.md).
