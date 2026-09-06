# Coverage and source policy

Version 0.1.0 is a foundation for applications launching in India, the United States, and Japan. It does not provide complete legal coverage, a tax filing service, legal advice, or automatic compliance certification. Country aliases and locale presets are conveniences; they do not establish a person's nationality, residence, tax domicile, or governing law.

## Sources reviewed on 2026-09-06

| Area | Primary source | Package behavior |
| --- | --- | --- |
| India GST | [CBIC Tax Information Portal](https://taxinformation.cbic.gov.in/) and [Notification 9/2025, Integrated Tax (Rate)](https://taxinformation.cbic.gov.in/view-pdf/1010431/ENG/Notifications) | Caller supplies a classified combined rate. The 2025 goods schedules and later amendments make a single frozen rate list inappropriate. No HSN/SAC classification or cess calculation is supplied. |
| US sales tax | [California Department of Tax and Fee Administration](https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm) | Requires a caller-supplied combined rate and jurisdiction. California illustrates state/local complexity; it is not a source for other states' rates. |
| Japan consumption tax | [National Tax Agency: Basic knowledge](https://www.nta.go.jp/english/taxes/consumption_tax/01.htm) and [NTA consumption-tax guides](https://www.nta.go.jp/english/taxes/consumption_tax/index.htm) | Standard 10%, reduced 8%, or explicit rate. Eligibility and registration are external decisions. |
| India DPDP | [MeitY 2025 rules and enforcement documents](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025), [Act commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf), [PIB announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014&lang=2&reg=3) | Planning checklist. The framework has phased commencement; the package intentionally does not assign one commencement date to all obligations. |
| US California privacy | [California Attorney General: CCPA](https://oag.ca.gov/privacy/ccpa) | Selected review controls. Caller must determine applicability; no automatic revenue/volume threshold decision. |
| US children's privacy | [FTC: COPPA business compliance guide](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business) | Selected controls for audience assessment, notices, parental consent/rights, safeguards, and retention. |
| Japan privacy | [PPC: laws and policies](https://www.ppc.go.jp/en/legal/) | Selected APPI review controls. Only the original Japanese texts have legal effect. |
| Time-zone behavior | [TC39 Temporal documentation](https://tc39.es/proposal-temporal/docs/zoneddatetime.html) | Temporal polyfill with explicit DST disambiguation; runtime ICU supplies zone data. |

Sources are reference links, not bundled copies of legislation. Review dates document a source review for this release, not a guarantee of present legal validity. Sources may change independently of package releases. Bundled law entries without a precise applicability period return `verify-commencement`; a query date different from `reviewedOn` sets `sourceReviewRequired`. Historical queries are not a historical legal database.

## Scope limits

- Only INR, USD, and JPY are supported for money. Country metadata contains convenient locale presets, not an exhaustive language list. US zones cover the 50 states and DC, not US territories.
- FX data comes from the caller. No live quotes, provider subscription, or auto-refresh is included.
- Tax arithmetic assumes the caller has determined taxable amounts, rates, jurisdiction, registration, exemptions, and supply treatment. No income-tax presets, payroll, customs, tax returns, credits, cess, or address-based tax lookup.
- Laws are selected privacy, child-data, and tax review checklists. They do not cover all state laws, sectors, employment, consumer protection, accessibility, payments, or all cross-border obligations.
- Legal control records track the latest user assertion. They do not inspect code, implement consent collection, or prove the control is operational.

## Updating rules

When changing a bundled rule, cite an official source, record the review date and actual effective period when established, describe the precise scope, add behavior tests if the calculation or selection changes, and publish a new package version. Do not silently rewrite an existing release asset. Applications needing continuously updated law/rate data should maintain reviewed custom rules and a refresh process outside this library.
