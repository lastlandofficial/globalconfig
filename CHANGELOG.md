# Changelog

## 0.6.0

- Add `glocon/compliance`: reviewed business/catalog configuration, dated treatment resolution, mixed-rate order calculations, inclusive/exclusive prices, discounts, grouped rounding, and reproducible snapshots.
- Add selected India/Japan invoice validation, printable invoice drafts, cumulative financial credit drafts, and a transactional SQLite store with persistent numbers and idempotency.
- Add compliance setup/check/lock/explain/source/diff commands, tax quotes, invoice creation/validation/rendering, and editor schemas.
- Add rule-revision evidence tracking to government plans while preserving existing progress assertions.
- Add React/Next.js checkout examples and tests for arithmetic, invoice fields, replay, CLI workflows and concurrent credit limits.
- Wait for initial page resources before UI measurements, preventing false target-size findings when stylesheets load slowly.
- Preserve existing country count and APIs. Financial credits retain statutory review requirements; no live tax filing or e-invoice registration is performed.


## 0.5.0

- Check interaction states through `glocon check`: named scenarios support click, fill, key presses, and retrying assertions for visibility, focus, enabled state, exact text, and retained input values.
- Make loading/error/retry/success checks repeatable with scoped browser API mocks, ordered responses, and requests held pending until scenario cleanup.
- Run every scenario in an isolated browser context at each viewport. Failed steps and unused mock responses are incomplete checks, even when findings are ignored.
- Show step outcomes and mock request counts in reports. Baselines include scenario behavior while preserving existing page-only identities.
- Add `glocon check --example`, TypeScript types, editor schema, and a practical scenario guide. Verify the shipped examples in clean-installed React/Vite and Next.js apps.


## 0.4.0

- Add framework-aware `glocon init --ui`: dependency/browser installation, Next static-route suggestions, safe repeat setup, and generated CI.
- Add `glocon check` with automatic server lifecycle, isolated page/viewport checks, local HTML/JSON reports, and highlighted screenshots.
- Reuse Playwright storage state and test setup commands; add interactive `glocon login` and explicit incomplete authentication coverage.
- Add reviewed, expiring baselines with new/regressed finding detection and identical local/CI thresholds.
- Add the Node-only `glocon/check` API and clean-install React/Vite and Next.js workflow verification.
- Preserve all existing country, component, standalone audit, and configuration APIs. No countries added.

## 0.3.0

- Broaden globalconfig into a JavaScript and TypeScript developer toolkit.
- Add UI snapshot audits, state contracts, browser and Playwright integrations, native measured-node checks, React primitives, and scoped styles.
- Add `glocon ui init`, `glocon audit`, `glocon doctor`, and `glocon rules`; UI configuration uses `glocon.ui.json`.
- Publish all UI APIs, docs, examples, and report schema under glocon, with optional React and Playwright peers.
- Keep existing country setup, plans, currency, time, and tax APIs compatible.


## 0.2.0 — 2026-09-06

- Add government-source implementation plans with deduplicated applicability questions, evidence suggestions, source-review flags, and recorded progress.
- Add specific official-source guidance for existing privacy and tax controls, plus separate COPPA disclosure-consent and retention-policy controls.
- Add `glocon init` and `glocon plan`, including JSON output, package-manager detection, and shared setup for frontend bundlers and Node.js.
- Support country shorthand, saved application facts, and restored review records in `createGlobalConfig`.
- Infer the tax country from the client while preserving country-specific TypeScript requirements and explicit-country calls.
- Add country-bound minor-unit helpers and integration guidance for TypeScript/JavaScript products.

## 0.1.1 — 2026-09-06

- Use globalconfig as the project name in the README and package description.
- Keep the npm package name and imports as `glocon`.
- Update publishing documentation to reflect the removal of the earlier package names.

## 0.1.0 — 2026-09-06

- Initial India, United States, and Japan country profiles.
- Decimal currency conversion, formatting, quote freshness, and minor units.
- Temporal-based time conversion with explicit DST disambiguation.
- India GST, caller-supplied US sales tax, Japan consumption tax, progressive arithmetic, and dated custom rate management.
- Selected source-linked legal review checklists and persistence-ready progress records.
- ESM, CommonJS, TypeScript declarations, and subpath imports.
- Public GitHub tarball distribution for npm, pnpm, Yarn, and Bun; npm registry publication pending.
