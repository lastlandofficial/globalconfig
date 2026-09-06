# From government sources to developer work

globalconfig helps TypeScript and JavaScript teams turn selected official requirements into implementation work. The workflow is: **review the source → answer applicability questions → implement the relevant controls → test and record evidence → revisit changes**.

## Get a plan from application facts

```ts
import { createGlobalConfig } from 'glocon';

const app = createGlobalConfig({
  country: 'US',
  facts: {
    collectsPersonalData: true,
    ccpaApplies: true, // Use a reviewed scope decision.
    servesChildrenUnder13: false,
    sellsTaxableItems: false,
  },
});

const plan = app.laws.plan();
for (const question of plan.questions) {
  console.log(question.fact, question.question, question.help, question.sources);
}
for (const task of plan.tasks) {
  console.log(task.ruleId, task.controlId, task.title);
  console.log(task.applicability, task.timing, task.timingNote);
  console.log(task.implementation, task.evidence, task.source);
}
```

The checklist covers selected India DPDP, California CCPA, US COPPA, Japan APPI, and indirect-tax review work. A country setting does not establish the complete set of governing laws for a business. US state tax examples are explicitly California sources; other states require their own authority review.

Questions are deduplicated across rules. A false condition excludes that rule's tasks; missing facts retain `needs-context`. Declared expired periods are excluded, and upcoming work remains labelled `upcoming`. `assess()` remains available for the full underlying selection, including excluded rules.

## Source-backed implementation suggestions

Each bundled control has an official source and suggested implementation/evidence artifacts. Those suggestions are our engineering interpretation, rather than prescribed code or proof of legal compliance.

| Area | Example implementation work | Authority |
| --- | --- | --- |
| India DPDP | Map provisions to commencement dates before enabling enforcement | [MeitY commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) |
| California CCPA | Carry applicable privacy opt-outs through affected integrations | [California Attorney General](https://oag.ca.gov/privacy/ccpa) |
| US COPPA | Review distinct parental consent for non-integral third-party disclosures and implement retention/deletion procedures | [FTC business guide](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business) |
| Japan APPI | Connect data-purpose inventories to notices and request workflows | [PPC general guidance](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/) |
| India GST | Map relevant invoice particulars into schema checks | [CBIC Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001) |
| California sales tax | Retain reviewed transaction location, combined rate, and effective dates | [CDTFA rate guidance](https://www.cdtfa.ca.gov/taxes-and-fees/know-your-rate.htm) |
| Japan consumption tax | Test grouping and one rounding operation per invoice tax rate | [NTA rounding guidance](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm) |

The package performs tax arithmetic after the caller supplies classification and rate inputs. The invoice, consent, request-handling, and retention tasks describe work in the application; generating a plan does not implement these systems.

## Record evidence and restore it later

```ts
app.laws.record({
  ruleId: 'us-ccpa',
  controlId: 'notices',
  status: 'done',
  note: 'Reviewed notice version 3; collection-flow tests in PR #42',
  updatedAt: new Date().toISOString(),
});

const saved = JSON.stringify(app.laws.exportRecords());
const restored = createGlobalConfig({
  country: 'US',
  facts: { collectsPersonalData: true, ccpaApplies: true },
  records: JSON.parse(saved),
});
console.log(restored.laws.plan().progress);
```

`progress` counts `todo`, `inProgress`, `done`, and `notApplicable` records. The latter two require notes. These are recorded review assertions, not a legal readiness score. Source-review flags and unanswered questions are independent of progress. Store records in your own backend; each client keeps its own in-memory copy.

## Keep requirements current

Source review dates describe this release's research. `sourcesToReview` lists relevant sources when the requested date differs from the recorded review date. This conservative flag does not detect whether a government page actually changed. CLI commands and library calls make no automatic legal-data fetches.

For a rule maintained by your team, use `createLawsManager({ rules })` or `register(rule)`. Controls may include `implementation`, `evidence`, and a more specific HTTPS `source`. Preserve stable IDs when the same control continues; add a new ID for materially new review work so an earlier `done` record does not complete it automatically. Keep the exact scope, source-review date, and established effective period with the rule.
