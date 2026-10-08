# Coverage and source policy

Version 0.7.0 (release candidate) provides selected government-source implementation plans and utilities for TypeScript and JavaScript applications launching in India, the United States, and Japan. It does not provide complete legal coverage, a tax filing service, legal advice, or automatic compliance certification. Country aliases and locale presets are conveniences; they do not establish a person's nationality, residence, tax domicile, or governing law.

## Tax and invoice workflows added in 0.6.0

`glocon/compliance` adds reviewed catalog treatments, order-level tax grouping and discounts, validated invoice drafts, printable HTML, financial partial credits, and replayable snapshots. `glocon/compliance/server` adds transactional SQLite numbering and idempotency. The CLI creates example projects and runs pinned transaction cases in CI. [Workflow and supported scenarios](compliance/README.md), [source review dated 2026-09-09](compliance/sources.md).

These selected ordinary domestic profiles cover India, Japan, and a California reference. Rates, registration, classification and applicability remain reviewed business inputs. Financial credit drafts always require statutory document review. Recording an invoice does not sign it, submit it to a government service, or certify legal compliance. Source monitoring detects document byte changes; it does not decide whether the law changed.

The older aggregate tax API and government checklists retain the scope below. Their source-review dates have not been renewed by the new invoice work.

## Sources reviewed on 2026-09-06

| Area | Primary source | Package behavior |
| --- | --- | --- |
| India GST | [CBIC Tax Information Portal](https://taxinformation.cbic.gov.in/) and [Notification 9/2025, Integrated Tax (Rate)](https://taxinformation.cbic.gov.in/view-pdf/1010431/ENG/Notifications) | Caller supplies a classified combined rate. The 2025 goods schedules and later amendments make a single frozen rate list inappropriate. No HSN/SAC classification or cess calculation is supplied. |
| US sales tax | [California Department of Tax and Fee Administration](https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm) | Requires a caller-supplied combined rate and jurisdiction. California illustrates state/local complexity; it is not a source for other states' rates. |
| Japan consumption tax | [National Tax Agency: Basic knowledge](https://www.nta.go.jp/english/taxes/consumption_tax/01.htm) and [NTA consumption-tax guides](https://www.nta.go.jp/english/taxes/consumption_tax/index.htm) | Standard 10%, reduced 8%, or explicit rate. Eligibility and registration are external decisions. |
| Japan invoice rounding | [NTA: rounding calculations, No. 6371](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm) | Aggregate by rate within a qualified invoice and round once per rate. The original arithmetic API expects callers to perform that grouping; the 0.6.0 order engine performs it. |
| India DPDP | [MeitY 2025 rules and enforcement documents](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025), [Act commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf), [PIB announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014&lang=2&reg=3) | Planning checklist. The framework has phased commencement; the package intentionally does not assign one commencement date to all obligations. |
| US California privacy | [California Attorney General: CCPA](https://oag.ca.gov/privacy/ccpa) | Selected review controls. Caller must determine applicability; no automatic revenue/volume threshold decision. |
| US children's privacy | [FTC: COPPA business compliance guide](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business) | Selected controls for audience assessment, notices, parental consent/rights, safeguards, and retention. |
| Japan privacy | [PPC: laws and policies](https://www.ppc.go.jp/en/legal/) | Selected APPI review controls. Only the original Japanese texts have legal effect. |
| Time-zone behavior | [TC39 Temporal documentation](https://tc39.es/proposal-temporal/docs/zoneddatetime.html) | Temporal polyfill with explicit DST disambiguation; runtime ICU supplies zone data. |

Implementation guidance also links to the [MeitY DPDP Act](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf), [2025 Rules](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf), [CBIC invoice Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001), [California registration and record guidance](https://taxes.ca.gov/sales-and-use-tax/doing-business/), [CDTFA rate guidance](https://www.cdtfa.ca.gov/taxes-and-fees/know-your-rate.htm), and PPC [general](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/) and [overseas-transfer](https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/) guidance. Control-level links identify the source used for each implementation suggestion. The updated FTC guide supports separate new COPPA controls for third-party disclosure consent and retention policy, preserving existing control IDs.

Sources are reference links, not bundled copies of legislation. Review dates document a source review for this release, not a guarantee of present legal validity. Sources may change independently of package releases. Bundled law entries without a precise applicability period return `verify-commencement`; a query date different from `reviewedOn` sets `sourceReviewRequired`. Historical queries are not a historical legal database.

## Scope limits

- Only INR, USD, and JPY are supported for money. Country metadata contains convenient locale presets, not an exhaustive language list. US zones cover the 50 states and DC, not US territories.
- FX data comes from the caller. No live quotes, provider subscription, or auto-refresh is included.
- Tax arithmetic assumes the caller has determined taxable amounts, rates, jurisdiction, registration, exemptions, and supply treatment. No income-tax presets, payroll, customs, tax returns, tax-credit eligibility, cess, or address-based tax lookup. The separate compliance module supports financial partial credits against recorded invoices.
- Laws are selected privacy, child-data, and tax review checklists. They do not cover all state laws, sectors, employment, consumer protection, accessibility, payments, or all cross-border obligations.
- Legal control records track the latest user assertion. They do not inspect code, implement consent collection, or prove the control is operational.
- `laws.plan()` and the CLI organize implementation work from the bundled rule catalog. They do not monitor government websites or update application behavior automatically.

## Updating rules

When changing a bundled rule, cite an official source, record the review date and actual effective period when established, describe the precise scope, add behavior tests if the calculation or selection changes, and publish a new package version. Do not silently rewrite an existing release asset. Applications needing continuously updated law/rate data should maintain reviewed custom rules and a refresh process outside this library.

## Runtime verification

The financial core is exercised in Node.js and Chromium, with isolated ESM, CommonJS, TypeScript and browser-bundle consumers. Clean-installed React/Vite and Next.js examples exercise quoting, invoice recording, partial credits, loading and retry. SQLite examples use Node.js 22.13 or later. A packaged Linux x64 Electron 44.7.0 application verifies the isolated renderer, exact currency/time/metered calculations, SQLite invoice retries and restart persistence, fractional credits, responsive renderer audits and a deliberate accessibility defect. Electron uses explicit same-origin accessibility analysis because its renderer context cannot open axe's standard aggregation target. Other operating systems and application-specific integrations require their own verification. An Android 15 Expo Go 57.0.9 fixture, with React Native 0.86.2 and static Hermes bytecode version 98, passes in hardware-accelerated CI. It verifies exact metered arithmetic, large currency display, minor-unit bounds, DST conversion, actual measured controls, invoice/credit button interactions, over-credit rejection, light/dark appearance and detection of a visible tiny unnamed control. The actual Hermes run exposed a decimal-string Intl precision bug; the repaired formatter also passes 567 legacy-Intl cases across nine locales and three currencies. These are representative fixtures; iOS, standalone production APKs, screen-reader behavior, keyboards and font scaling require their own checks.

### Earlier utility verification

The 0.2.0 changes were checked with runtime tests on Node.js 22, isolated ESM/CommonJS and TypeScript consumers, a globally installed CLI, and a generated frontend bundle with no Node-only imports. Seven runtime smoke checks also passed in Chromium, including exact money formatting, tax calculations, time conversion, and review planning. Full React Native/Hermes, Electron, and Next.js applications were not run in this repository; verify integration and locale behavior in your target runtime.

## Acceptance and evidence in 0.7.0

Financial checks require reviewed expected totals and declare quote/invoice coverage. Status-only fixtures and quote-only fixtures in the default invoice scope exit 2. Assertions against an old law revision remain recorded progress but are visibly marked `review-required` in both text and JSON plans. A legal plan is a user assertion record; it is not an operational audit or immutable evidence history. DOM collection truncation exits 2 by default; explicitly accepted partial collection cannot resolve old baseline findings or create a new baseline. Native measurements are validated but do not establish device coverage. See [audit repair tracking](audit-repairs.json) for engineering results and external readiness gates.

### 0.7.0 candidate validation on 2026-10-08

The full check passes 75 Node tests, 60 unit tests and 22 Chromium tests. Ten rendered-page tests pass in each of Chromium, Firefox and WebKit in the separate rendered-page matrix on Ubuntu CI. The independent BigInt/rational oracle checks 1,500 ordinary orders across all 24 country/rounding/pricing combinations and another 1,500 metered orders across all 96 country/line-rounding/tax-rounding/pricing combinations, with mixed-rate cases in every supported country. Node 20 passes 72 tests with three explicitly skipped SQLite tests; Node 24 passes all 75. Fresh packed installations pass npm, pnpm, Yarn and Bun, ESM/CommonJS, and TypeScript declarations. Clean Vite and Next examples pass 18 and 20 configured checks respectively, including financial lifecycles, state scenarios and baseline/regression handling; Next also verifies login and expired-session detection. Full dependency audit reports zero known vulnerabilities. All eight [CI jobs](https://github.com/lastlandofficial/globalconfig/actions/runs/37717548427) pass, including packaged Electron and Android Hermes. Public distribution remains pending; its verification gate rejects the older registry latest.

Six saved 0.6.0 calculations, six invoice drafts and nine credits (ordinary and fractional-tax examples for every country) replay in 0.7.0 without changing their original digests. These fixtures were generated with the original 0.6.0 package. This protects persisted accounting snapshots while the aggregate API adopts the shared default policy.

The [independent trial worksheet](readiness-trial-template.json) records fresh onboarding, real state/authentication coverage, finding accuracy, reviewed financial expectations and adoption value. Its fields remain unfilled until an independent developer and relevant business reviewer run it.
