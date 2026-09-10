# Tax and invoice workflows

Available in glocon 0.6.0. Configure reviewed business and product decisions once, calculate orders, validate invoice drafts, and check regression cases in CI. The package includes selected India GST and Japan qualified-invoice checks plus a California rate-decision reference. A ready result means the configured calculation or selected checks passed, not that every applicable law has been satisfied.

## Try a complete example

In an existing JavaScript/TypeScript project:

```sh
npm install glocon
npx glocon compliance init --country JP --demo
npx glocon compliance check
npx glocon tax quote glocon.examples/order.json
npx glocon invoice create glocon.examples/order.json --details glocon.examples/invoice-details.json --output invoice.json
npx glocon invoice validate invoice.json
npx glocon invoice render invoice.json --output invoice.html
```

Open `invoice.html`. The example contains two fictional JPY 1,000 items at a demonstration 10% treatment: net 2,000, tax 200, gross 2,200. Example product classifications and reviewer records are deliberately labelled fictional. `--demo` also works with IN and US; those sample rates are illustrative inputs, not recommendations for your products.

Setup writes configuration, a lockfile, financial test cases, example order/details files, and `glocon.examples/server.mjs`. Existing destinations are preserved. `invoice create` and `invoice render` also refuse to overwrite existing output files. Use a different filename for another draft.

## Use reviewed business data

For a production starting point, omit `--demo`:

```sh
npx glocon compliance init --country IN
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

The calculation core has no DOM, React, database, or Node imports. It is verified in Node and Chromium; full Electron and React Native/Hermes runtime integration has not been verified for this release. The HTML renderer is an optional function returning a string.

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

- Money and rates are decimal strings. Quantities are positive whole numbers up to 1,000,000; fractional quantity/unit-price handling is outside this initial engine.
- Prices come from the catalog. Order lines reference product IDs and provide quantity and optional fixed-amount discounts; they cannot override prices.
- Line discounts apply first, then an order discount is allocated proportionally to the remaining line charges using integer minor units and largest remainders. Input order breaks remainder ties.
- Inclusive discounts reduce inclusive charges; exclusive discounts reduce net charges. The business must review whether that discount treatment is appropriate. Conditional/rebate rules are not inferred.
- Rate groups remain separate by treatment and rate. Taxable rates must be positive; zero-rated, exempt, and out-of-scope treatments need zero rates and reasons.
- Japan groups the invoice basis by rate, rounds each group's tax once, then allocates the result to lines for accounting. Allocated line tax is not an independently rounded line-tax calculation.
- India intra-state calculations round CGST and SGST/UTGST separately at their half-rates and sum them. Inter-state calculations use IGST. This is a documented calculation policy for reviewed inputs, not a decision about supply classification or statutory return rounding.
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

Use `glocon/compliance/server` with a synchronous SQLite connection. The included Node example requires Node.js 22.13+ because it imports `node:sqlite`; the rest of glocon continues to support Node 20+. The adapter's database interface also permits other compatible synchronous SQLite drivers, but the tested adapter is Node's `DatabaseSync`.

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

The store uses immediate transactions, persistent sequences, and business-scoped idempotency keys. The same key/input returns the original result; different input under that key is rejected. India sequences use an April–March financial-year start; other profiles use the calendar year. Do not share this connection with another active transaction. The business ID must be your canonical tenant identity, not a value accepted unchecked from a request.

`store.credit({ business, originalNumber, key, request })` reads the original invoice and complete prior credit history inside the transaction. Cumulative allocations preserve the original amounts; the last full-quantity credit collects the rounding remainder. Concurrent requests cannot credit more quantity than remains.

These are **financial credit drafts/records** with `legalStatus: 'review-required'`. They are not jurisdiction-complete statutory credit notes or automatic refunds through a payment processor. The supplied review reference must cover eligibility; statutory format, timing, tax reporting adjustments, and payment execution remain external work.

Protect the database, snapshots, and evidence references. Authorize the authenticated business/customer, apply normal endpoint protections, and reconstruct authoritative inputs on the server. The local demo endpoint in `examples/compliance/service.mjs` is intentionally unauthenticated and must not be deployed as a public production API.

## Rule locks, replay and source checks

`createComplianceLock(config)` and `glocon compliance lock` pin the configuration and rule-pack content digests. CLI quotes/checks reject a mismatching lock until you review and repin the configuration. This is reproducibility, not an approval or signature. A digest does not prove authenticity: callers can edit data and recalculate a digest. Never trust a client-supplied calculation snapshot as server authority.

`verifyCalculation(calculation)` recalculates the embedded inputs using engine `glocon-order-1` and compares the complete output. Original snapshots retain their original catalog and rules after your current configuration changes. Unsupported engine versions fail verification; retain the original engine/package artifact for long-term reproduction across incompatible future engine revisions.

```sh
npx glocon compliance explain JP-INVOICE-ROUNDING
npx glocon compliance rules diff proposed-config.json
npx glocon compliance sources check
npx glocon compliance sources check --record
```

The diff reports added/removed/changed requirements and treatment records. Source checks are explicit network operations against allowlisted official hosts, with bounded response sizes and timeouts. Results are `unchanged`, `changed`, `unavailable`, or `not-checked`. They compare document bytes, so navigation/text-format changes can trigger review without a change in law. A missing baseline is `not-checked`, even when a digest was retrieved. A failed fetch is `unavailable`, never unchanged. `--record` saves retrieved digests in `glocon.sources.json`; it does not renew legal reviews or change calculation rules.

Review deadlines are maintainer/business workflow choices, not statutory validity dates. Runtime calculations do not fetch source updates. Queries outside reviewed/effective windows remain incomplete. Source checking cannot establish whether all amendments have been incorporated.

## Financial CI cases

`glocon.compliance.cases.json` is an array of named cases containing `order`, optional invoice `details`, and `expected`. Ready cases can assert exact `net`, `tax`, and `gross`; negative cases can assert an incomplete/invalid status and required `issueCodes`.

```json
{
  "name": "known transaction",
  "order": { "...": "your complete Order object" },
  "expected": { "status": "ready", "net": "2000", "tax": "200", "gross": "2200" }
}
```

The snippet illustrates the case shape; replace the order placeholder. Review expected totals independently of the implementation. The demo's generated expectations are for onboarding, not an independent verification of your business's tax obligations.

Run `npx glocon compliance check --json` in CI. It writes `.glocon/compliance-report.json`: 0 means case expectations passed with at least one ready transaction, 1 a verified mismatch, 2 incomplete/setup failure. Expected negative cases demonstrate error handling; they are not evidence that those transactions can be issued. A suite containing only incomplete cases cannot pass. UI baselines do not apply to financial checks. No network source check is implicit in this command.

## Existing government plans

The `glocon/laws` API adds optional `reviewAfter` and `revision` on custom rules, and records the rule revision with new control assertions. Imported unversioned or outdated records retain their original status but receive `recordReviewRequired` and `verification: 'review-required'` in assessments/plans. `plan.evidence` distinguishes current-revision records, reviews needed, and absent records. These remain assertions, not proof that application behavior was inspected.

Existing `plan.progress` counts keep their original meaning for backward compatibility. Rules without `reviewAfter` keep the conservative legacy source-date behavior. Add a documented review deadline to custom rules to avoid treating every new day as a detected source change.
