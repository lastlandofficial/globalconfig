# Tax and invoice workflows

Introduced in glocon 0.6.0; this guide describes 0.7.0 (release candidate). Configure reviewed business and product decisions once, calculate orders, validate invoice drafts, and check regression cases in CI. The package includes selected India GST and Japan qualified-invoice checks plus a California rate-decision reference. A ready result means the configured calculation or selected checks passed, not that every applicable law has been satisfied.

## Try a complete example

This guide requires the locally built **0.7.0 candidate**. Default registry installation still serves the older version recorded in the [installation status](../../README.md#install). Build an archive from this checkout with `npm ci` and `npm pack`, then install it in an existing JavaScript/TypeScript project; replace the archive path below:

```sh
npm install /path/to/globalconfig/glocon-0.7.0.tgz
npx --no-install glocon --version
# Expected candidate version: 0.7.0
npx --no-install glocon compliance init --country JP --demo
npx --no-install glocon compliance check
npx --no-install glocon tax quote glocon.examples/order.json
npx --no-install glocon invoice create glocon.examples/order.json --details glocon.examples/invoice-details.json --output invoice.json
npx --no-install glocon invoice validate invoice.json
npx --no-install glocon invoice render invoice.json --output invoice.html
```

Open `invoice.html`. The example contains two fictional JPY 1,000 items at a demonstration 10% treatment: net 2,000, tax 200, gross 2,200. Example product classifications and reviewer records are deliberately labelled fictional. `--demo` also works with IN and US; those sample rates are illustrative inputs, not recommendations for your products.

Setup writes configuration, a lockfile, financial test cases, example order/details files, and `glocon.examples/server.mjs`. Existing destinations are preserved. `invoice create` and `invoice render` also refuse to overwrite existing output files. Use a different filename for another draft.

## Use reviewed business data

For a production starting point, omit `--demo`:

```sh
npx --no-install glocon compliance init --country IN
```

The generated configuration leaves registration and tax treatment unresolved. A quote returns `needs-context` until you complete the required decisions. Edit `glocon.compliance.json` using its editor schema:

1. Replace the business identity/address and record reviewed registration status and identifiers.
2. Replace the product catalog with server-owned prices, descriptions, classifications, and units. Shipping can be a separate classified product line.
3. Add treatments for each product and exact jurisdiction: rate, taxable/zero-rated/exempt/out-of-scope category, effective dates, reviewer, source/evidence reference, and review deadline.
4. Record a business scope review covering the selected ordinary-domestic profile, applicable exceptions, document requirements, and registration decisions. India additionally requires explicit intra/inter-state supply and local-tax choices where relevant, plus invoice signature/IRP decisions.
5. Replace example transactions and independently reviewed expected totals. Review your changes, then run `glocon compliance lock` and `glocon compliance check`.

`--input reviewed-config.json` imports an existing validated configuration. It leaves the financial case list empty so that you supply cases matching your catalog. The generated example order is a shape template; adapt its product IDs, dates, parties, and jurisdiction to your imported data.

Business evidence is a caller assertion. Tax-ID checks are structural checks only. The library does not verify registrations, infer nexus or product classification, or determine governing law from a country/ZIP code.

## Library API

The calculation core has no DOM, React, database, or Node imports. Existing representative verification covers Node, Chromium, a packaged Linux Electron application and an Android Expo Go/Hermes fixture. These results apply to those fixtures; verify your own engine, operating system and application integration. See the [runtime coverage](../coverage.md#runtime-verification). The HTML renderer is an optional function returning a string.

```ts
import {
  calculateOrder,
  createInvoiceDraft,
  validateInvoice,
  createCreditNoteDraft,
  createComplianceExample,
  type ComplianceConfig,
  type Order,
} from 'glocon/compliance';

// Learning fixture only. Use your reviewed server-owned config and order in production.
const { config, order, details } = createComplianceExample('JP');
const quote = calculateOrder(config, order);
if (quote.status !== 'ready') {
  console.log(quote.status, quote.issues); // code, field, message, fix, source when available
} else {
  console.log(quote.value.net, quote.value.tax, quote.value.gross);
  console.log(quote.value.groups, quote.value.lines);
}

const result = createInvoiceDraft(config, order, details);
if (result.status === 'ready') {
  const invoice = result.value;
  console.log(validateInvoice(invoice));
  const credit = createCreditNoteDraft(invoice, {
    number: 'C/2026/1',
    date: order.date,
    reason: 'One item returned',
    review: config.business.review!, // Replace with the actual credit-eligibility review.
    lines: [{ lineId: 'item-1', quantity: 1 }],
  }, []); // Complete prior credit history is required for subsequent credits.
  console.log(credit);
}
```

Results are `ready`, `needs-context`, `unsupported`, or `invalid`. Consumers must branch on `status`. Incomplete decisions never become a zero tax rate. Inputs are copied; successful outputs and their snapshots are frozen. JSON schemas are exported as `glocon/compliance-config.schema.json` and `glocon/order.schema.json`.

## Calculation behavior

- Money and rates are decimal strings. Without a billing policy, quantities remain positive whole numbers up to 1,000,000 and catalog prices use currency precision. A reviewed `billing` policy enables exact decimal-string quantities and prices up to 18 decimal places.
- Prices come from the catalog. Order lines reference product IDs and provide quantity and optional fixed-amount discounts; they cannot override prices.
- Line discounts apply first, then an order discount is allocated proportionally to the remaining line charges using integer minor units and largest remainders. Input order breaks remainder ties.
- Inclusive discounts reduce inclusive charges; exclusive discounts reduce net charges. The business must review whether that discount treatment is appropriate. Conditional/rebate rules are not inferred.
- Rate groups remain separate by treatment and rate. Taxable rates must be positive; zero-rated, exempt, and out-of-scope treatments need zero rates and reasons.
- Current Japan taxable order treatments must use the supported 8% or 10% rates. Japan groups the invoice basis by rate, rounds each group's tax once, then allocates the result to lines for accounting. Allocated line tax is not an independently rounded line-tax calculation.
- India intra-state calculations default to `indiaRounding: "components"`: round CGST and SGST/UTGST separately at their half-rates and sum them. The optional `"combined"` policy rounds the combined tax first and allocates its remainder to local tax. `calculateTax` uses the same default and optional policy. Store the business-reviewed selection in the compliance config and use the same selection for previews. Inter-state calculations use IGST. This is a documented calculation policy for reviewed inputs, not a decision about supply classification or statutory return rounding.
- California uses an explicitly reviewed combined rate and jurisdiction. The business chooses the supported rounding mode (`half-up`, `half-even`, `down`, `up`). No nationwide rate lookup is supplied.
- All net, tax, gross, component, discount, and allocation totals reconcile. An impossible rounding/amount combination returns `invalid`.

`createReviewedTaxProvider(treatments)` exposes the same exact-jurisdiction/date selection as a `TaxProvider`. A match must be unique and reviewed; `effectiveTo` and review `after` are exclusive boundaries. The built-in engine intentionally uses validated local rules. An external service can populate reviewed treatment records; no external provider or paid account is required or automatically called.

## Invoice checks and document limits

See [source and profile coverage](sources.md) for the exact implemented checks. The initial document profiles are deliberately narrow:

- **India:** selected ordinary taxable domestic invoice particulars; explicit signature and e-invoice applicability review. Supply the relevant place-of-supply text for inter-state cases. Recorded IRN/QR/signature evidence is caller-verified; the library does not contact an IRP, create a digital signature, render the signed QR, or enforce every notification-specific declaration. The printable output remains a draft.
- **Japan:** ordinary qualified invoices with reviewed 8%/10% taxable categories, issuer-number syntax, rate grouping and reduced-rate labelling. Simplified invoices and special document types are not implemented.
- **US:** a general document/calculation workflow with a California rate-decision reference. It is not a comprehensive California invoice validator or a legal profile for other states.

IN/JP zero-rated, exempt, or out-of-scope amounts can be calculated, but the initial invoice creator returns `unsupported` for those document cases. Cross-border, reverse-charge, marketplace, special supplies, cess, filing/remittance, and income/payroll tax are outside this workflow.

A generated or recorded draft is not a legally issued/signed document. Complete applicable external registration, signing, required declarations and delivery steps in the business's issuance process. The SQLite method named `issue` reserves a number and records a validated draft snapshot; it does not perform those external steps.

## Persistence and retry-safe server integration

Use `glocon/compliance/server` with a synchronous SQLite connection. The included Node example requires Node.js 22.13+ because it imports `node:sqlite`; the rest of glocon requires Node 20.3+. The adapter's database interface also permits other compatible synchronous SQLite drivers, but the tested adapter is Node's `DatabaseSync`.

```ts
import { DatabaseSync } from 'node:sqlite';
import { createSQLiteInvoiceStore } from 'glocon/compliance/server';

const db = new DatabaseSync('invoices.sqlite');
const invoices = createSQLiteInvoiceStore(db);
const saved = invoices.issue({
  key: 'order-42-attempt-1',
  config, // Trusted server-owned configuration.
  order,  // Built from authorized customer/order records.
  details: { issuedOn: order.date },
});
```

The store uses immediate transactions, persistent sequences, and business-scoped idempotency keys. The same key/input returns the original persisted result before applying newer validation rules, so retries do not become new issuance after a review expires or the engine changes. Different input under that key is rejected; distinct new requests validate and recalculate, and failed requests roll back their reserved sequence. India sequences use an April–March financial-year start; other profiles use the calendar year. Do not share this connection with another active transaction. The business ID must be your canonical tenant identity, not a value accepted unchecked from a request.

`store.credit({ business, originalNumber, key, request })` reads the original invoice and complete prior credit history inside the transaction. Cumulative allocations preserve the original amounts; the last full-quantity credit collects the rounding remainder. Concurrent requests cannot credit more quantity than remains.

Current engine-3 invoice issuance requires the actual business, billing, selected treatment and source reviews to have occurred by `issuedOn` and to remain unexpired. Explicit earlier review applicability permits calculating a retrospective transaction, but does not permit issuing a document before its review took place. Current credits must follow their actual eligibility-review `on` date and fall within its applicability period. Historical engine-1/2 invoices and retained version-1 credits preserve their registered validation behavior. New version-2 credits for an older original require current completed review and bounded request quantities; historical source quantities and prior version-1 credit parsing remain replayable.

New credit drafts default to version 2 for engine-3 invoices or histories already containing version-2 credits. They contain `previousDigest` (null for the first credit) and `historyLength`, keeping each new document's predecessor metadata constant in size. Legacy version-1 credits retain `previousDigests` and replay unchanged. The optional fourth argument to `createCreditNoteDraft` is `{ version: 1 | 2 }`; use `{ version: 2 }` to explicitly upgrade credits for an older original. Complete ordered history remains required, including mixed versions, and is recomputed before accepting another credit; a predecessor reference does not make caller totals trustworthy. At most 10,000 prior credits may be supplied. The pure API cannot know whether a caller omitted valid trailing history; obtain the authoritative complete history from trusted storage. SQLite reads that persisted history inside the transaction.

SQLite writes new credits in version 2, reads existing version-1 history, and adds its history index idempotently to existing databases. It does not rewrite retained documents or perform a payment refund.

These are **financial credit drafts/records** with `legalStatus: 'review-required'`. They are not jurisdiction-complete statutory credit notes or automatic refunds through a payment processor. The supplied review reference must cover eligibility; statutory format, timing, tax reporting adjustments, and payment execution remain external work.

Protect the database, snapshots, and evidence references. Authorize the authenticated business/customer, apply normal endpoint protections, and reconstruct authoritative inputs on the server. The local demo endpoint in `examples/compliance/service.mjs` is intentionally unauthenticated and must not be deployed as a public production API.

## Rule locks, replay and source checks

`createComplianceLock(config)` and `glocon compliance lock` pin the configuration and rule-pack content digests. CLI quotes/checks reject a mismatching lock until you review and repin the configuration. This is reproducibility, not an approval or signature. A digest does not prove authenticity: callers can edit data and recalculate a digest. Never trust a client-supplied calculation snapshot as server authority.

New calculations and locks use `glocon-order-3` with executable profile `glocon-ordinary-domestic-1`, for both whole-unit and metered billing. `replayCalculation(calculation)` dispatches the stored engine/profile and recomputes its retained inputs; `verifyCalculation(calculation)` compares the complete replayed output and digest. Legacy engine 1/2 fixtures retain their historical semantics and original digests. Unsupported versions/profiles fail verification. Original snapshots retain their catalog and rules after current configuration changes; retain the original package artifact for long-term reproduction.

An upgrade from a legacy engine lock requires an explicit review and `glocon compliance lock` before current CLI quotes/checks. Repinning permits new calculations under the current engine; it does not rewrite retained historical snapshots.

```sh
npx --no-install glocon compliance explain JP-INVOICE-ROUNDING
npx --no-install glocon compliance rules diff proposed-config.json
npx --no-install glocon compliance sources check
npx --no-install glocon compliance sources check --record
npx --no-install glocon compliance sources check --concurrency 4 --per-host-delay 200 --timeout 60000
```

The diff reports added/removed/changed requirements and treatment records. Source checks are explicit network operations against allowlisted official hosts. They accept complete HTTP 200 HTML/XHTML, PDF or plain-text documents, reject partial/content-range responses and empty documents, and bound each body to 5 MiB. Where an unencoded `Content-Length` is supplied, it must match the retrieved body. A failed or incomplete retrieval is `unavailable` and never becomes a baseline.

Results are `unchanged`, `changed`, `unavailable`, or `not-checked`. Observations disclose `reviewRequired` and, where available, `effectiveURL` and the full `redirectChain`. Byte changes or a changed final destination require review, even if redirected bytes match the earlier digest. They do not establish a change in law. A missing baseline is `not-checked` even when retrieval succeeded. Legacy digest-only entries remain readable; redirected legacy entries need explicit destination review.

`glocon.sources.json` is a plain object keyed by source URL. Legacy SHA-256 strings are accepted; `--record` writes successful entries as `{ version: 1, digest, effectiveURL }`, preserves unavailable entries and atomically replaces the file only when at least one document was retrieved successfully. Arrays, null, malformed digests and malformed records fail before network/write work. Review the reported document and destination before recording. Recording does not renew legal reviews or update calculation rules; a run that detected a changed source still exits 1 after recording it.

`checkSources(requirements, baseline, fetcher?, options?)`, `validateSourceBaseline` and `recordSourceBaseline` are exported from the Node-only `glocon/compliance/sources` entry. Source checks use a bounded pool with global `concurrency` 1–32 (default 4), `perHostConcurrency` 1 up to the global limit (default 1), and `perHostDelayMs` 0–60,000 (default 200). Overall `timeoutMs` includes queueing and defaults to 60,000; it accepts 1–3,600,000 milliseconds. Per-document `requestTimeoutMs` starts when its first request begins, includes redirects/body, and defaults to 12,000 (range 1–300,000). `signal` supports external cancellation. CLI `--concurrency`, `--per-host-delay` and `--timeout` select the global concurrency, host delay and overall deadline. These controls bound retrieval work; they do not replace legal interpretation.

Review deadlines are maintainer/business workflow choices, not statutory validity dates. Runtime calculations do not fetch source updates. Current transactions must fall in the applicable reviewed/effective windows. A `Review.appliesFrom` date defines the inclusive lower transaction boundary and defaults to the review `on` date; `after` is exclusive. Requirement `reviewAppliesFrom` defaults to `reviewedOn`, with exclusive `reviewAfter`. A reviewer can explicitly record earlier applicability for retrospective transactions without changing the date the review occurred. Queries outside these windows remain incomplete. Source checking cannot establish whether all amendments have been incorporated.

## Financial CI cases

`glocon.compliance.cases.json` is an array of named cases containing `order`, optional invoice `details`, and `expected`. Every ready case requires exact `net`, `tax`, and `gross` strings. Rejection cases require a non-ready status and specific `issueCodes`. Choose an acceptance scope: invoices by default, `--scope quotes` for quote-only projects, or `--scope both`.

```json
{
  "name": "known transaction",
  "order": { "...": "your complete Order object" },
  "expected": { "status": "ready", "net": "2000", "tax": "200", "gross": "2200" }
}
```

The snippet illustrates the case shape; replace the order placeholder. Review expected totals independently of the implementation. The demo's generated expectations are for onboarding, not an independent verification of your business's tax obligations.

Run `npx --no-install glocon compliance check --json` in CI. It writes `.glocon/compliance-report.json`: 0 means the declared scope has successful exact coverage and all expectations passed, 1 an observed mismatch, and 2 incomplete/setup failure. Expected negative cases demonstrate error handling; they are not evidence that those transactions can be issued. A suite containing only incomplete cases cannot pass. UI baselines do not apply to financial checks. No network source check is implicit in this command.

## Existing government plans

The `glocon/laws` API adds optional `reviewAfter` and `revision` on custom rules, and records the rule revision with new control assertions. Imported unversioned or outdated records retain their original status but receive `recordReviewRequired` and `verification: 'review-required'` in assessments/plans. `plan.evidence` distinguishes current-revision records, reviews needed, and absent records. These remain assertions, not proof that application behavior was inspected.

Existing `plan.progress` counts keep their original meaning for backward compatibility. Rules without `reviewAfter` keep the conservative legacy source-date behavior. Add a documented review deadline to custom rules to avoid treating every new day as a detected source change.

## Exact financial CI acceptance

`glocon compliance check` defaults to `--scope invoices`. At least one ready invoice fixture must include independently reviewed expected `net`, `tax`, and `gross` strings. Every ready fixture requires all three totals. Expected rejection fixtures require specific `issueCodes`. A quotes-only project must explicitly select `--scope quotes`; `--scope both` requires successful exact quote and invoice coverage. Negative cases alone do not establish successful calculation or invoice coverage. Reports include the selected scope, ready cases, exact assertions, actual totals and coverage gaps. Exit codes are 0 for passing complete coverage, 1 for observed regressions, and 2 for incomplete coverage or unresolved required context.

The portable `checkFinancialCases(config, cases, { scope })` API applies the same acceptance rules. The published `glocon/financial-cases.schema.json` describes the fixture format. Without a billing policy, whole quantities and currency-precision catalog prices remain the default boundaries. The reviewed precision workflow below extends both boundaries.

## Metered and fractional billing

Opt in using a policy reviewed for the transaction date:

```ts
config.billing = {
  quantityPrecision: 6,
  unitPricePrecision: 6,
  lineRounding: 'half-even',
  review: { by: 'Business reviewer', on: '2026-10-08', after: '2027-01-01', reference: 'Reviewed billing decision reference' },
};
config.products[0].unitPrice = '0.335';
order.lines[0].quantity = '1.5';
```

Fractional quantities must be plain decimal strings; floating-point quantities such as `0.1` are rejected. Both precision limits are integers from 0 to 18. Quantity must be positive and no greater than 1,000,000. Extend each trusted catalog price by its exact quantity, subtract the fixed line discount, then round that line charge to currency precision using `lineRounding`. Apply the order discount after this step, and use the existing tax rounding policy for each rate group. Money discounts and final amounts remain whole currency minor units. Sub-minor charges may round to zero according to the reviewed policy. All extended amounts and final totals must remain below 1e30 for ordinary and metered calculations. Decimal input strings are bounded to 1,024 characters before parsing; financial text fields are bounded to 10,000 Unicode code points.

New ordinary and metered calculations use `glocon-order-3`; metered snapshots retain the complete billing policy. Existing engine 1/2 calculations replay through their registered historical engines without changing their recorded results. Credit requests use the original precision policy and exact integer quantity units; cumulative partial credits collect all remaining minor units at full quantity without floating-point drift. SQLite stores decimal quantities as part of the original JSON document and checks complete credit history inside its existing transaction. Eligibility and external issuance remain reviewed business steps.

Try the fictional metered fixture with `glocon compliance init --country JP --demo --metered`, then `glocon compliance check`. `createMeteredComplianceExample(country)` exposes the same example and independently specified expected totals. Production setup requires your reviewed input configuration.
