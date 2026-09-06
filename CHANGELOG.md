# Changelog

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
