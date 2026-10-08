# Independent application trials

The current release candidate has automated fixtures. Independent developer and business trials remain **pending**. This protocol and the [worksheet](readiness-trial-template.json) prepare the work; they do not report completed trials or measured adoption results.

The first adoption question is whether one of the supported workflows saves work in an existing application. Test UI and financial workflows separately. A UI participant does not need to configure a tax business, and a financial participant does not need to author browser scenarios.

## Freeze the trial before starting

Record the candidate archive integrity, source commit, protocol revision, participant independence, target application and selected workflow. Commit the acceptance criteria before the first session. The thresholds below are proposed product acceptance targets, not measured performance claims. If a target must change, retain the original outcome and start a new protocol revision instead of changing a target after seeing results.

Recruit at least three developers independent of the package author for UI trials, using at least two real application frameworks. Recruit at least two independent developer/business-reviewer teams for financial trials, using the document profile the target business actually needs. Do not add countries merely to satisfy a trial count. Include an application with existing integration complexity, not just an empty starter project.

Observe the first attempt without instructions beyond the published guide. Record assistance and errors before helping. Stop the unaided timing measurement when help is given. Participants can then continue with help to identify the underlying obstacle. Use test accounts and appropriately de-identified financial data, retain evidence in the application's approved storage, and publish aggregate results with the participants' permission.

## UI workflow

1. Install the exact candidate in the existing app and record `glocon --version`.
2. Run UI setup, inspect its detected pages/start command, and obtain phone and desktop reports. Record elapsed time and every intervention.
3. Exercise a real protected page with a valid test session, invalidate the session, and confirm the second run is incomplete. If authentication is outside this app's scope, mark this task inapplicable and test it in another trial application.
4. Configure actual loading, empty, error, retry and success states where they exist. Verify recovery, retained input and focus in addition to visible UI. Record scenario-authoring difficulties.
5. Review every reported error and warning against the actual application. Record the rule, target, confirmed defect, false-positive reason, whether the suggestion was actionable, and time to fix. Include deliberate known defects and an incomplete collection to check failure handling.
6. Adopt an explicitly reviewed baseline, fix one issue, introduce one regression, and confirm the resulting report distinguishes each event.

Predeclared acceptance targets:

- At least two of three participants obtain their first usable phone/desktop report unaided within 15 minutes.
- No tested wrong destination, expired session or incomplete collection receives a passing result.
- Review at least 20 error/warning findings across the trial applications; at least 80% must be confirmed defects with an actionable next step. If fewer findings exist, report the smaller sample and keep this criterion unresolved rather than manufacturing findings.
- At least two participants complete a real state scenario and baseline/regression workflow, and can explain the report's coverage limits.
- At least two participants report a specific fix or avoided repeated task and choose to continue using the workflow. Record the reasons for every non-adoption decision.

## Financial workflow

1. Install the exact candidate and select the actual supported jurisdiction, document type, quantity/price precision and rounding policy with a qualified business reviewer.
2. Complete the trusted catalog, treatment records, business review and applicability periods. Record the evidence reference and any requirements the package cannot support.
3. Prepare independently computed expected amounts before running the library. Include a successful quote and invoice, mixed rates or discounts where applicable, boundary rounding, an expired/out-of-scope review and an unsupported supply. Use at least five cases per business.
4. Run acceptance with `--scope both`, inspect each result and verify selected invoice fields against the reviewer's requirements. A ready draft is not evidence of government registration, signing, delivery or filing.
5. Record an invoice and partial credits, retry a request, restart the store and attempt an excessive credit. Confirm exact remaining quantities and amounts. Metered businesses must include fractional quantities under their reviewed precision policy.
6. Replay retained calculations and credits after a configuration change. Review any lock migration and India rounding migration that applies; preserve the original package/artifact needed for historical reproduction.

Predeclared acceptance targets:

- Both teams agree with 100% of independently expected net, tax and gross amounts in their selected cases.
- No tested expired review, missing required decision, unsupported supply or excessive credit receives a ready result.
- Retry/restart behavior returns the original result for the same request and rejects changed input under that key.
- All required selected-profile invoice fields and credit eligibility have an explicit business review. Unimplemented statutory issuance or payment steps have a documented external process; they are not marked complete by the library.
- Both teams can identify the work saved and the remaining integration work. Adoption and non-adoption reasons are recorded; unsupported core business requirements block acceptance for that business.

## Record the outcome

Copy the worksheet for each participant/team, select `ui` or `financial`, and fill only observed results. The acceptance counts and fractions apply to the whole cohort; an individual worksheet alone does not establish cohort acceptance. Keep raw failures and assistance in the record. A facilitator and independent reviewer assess the criteria after the sessions. Report sample size, application scope, package integrity, elapsed time, finding dispositions, unsupported requirements and unresolved criteria together.

Do not replace automated fixture counts with trial counts or describe an unrun worksheet as successful usability validation. A completed trial applies to its tested application and workflow; broader native, framework, jurisdiction and assistive-technology coverage requires its own evidence.
