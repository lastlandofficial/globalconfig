import type { LawControl } from './laws';

type Guidance = Required<Pick<LawControl, 'implementation' | 'evidence' | 'source'>>;

const dpdpAct = 'https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf';
const dpdpRules = 'https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf';
const ccpa = 'https://oag.ca.gov/privacy/ccpa';
const coppa = 'https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business';
const appi = 'https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/';
const gst = 'https://taxinformation.cbic.gov.in/';
const californiaTax = 'https://taxes.ca.gov/sales-and-use-tax/doing-business/';
const japanTax = 'https://www.nta.go.jp/english/taxes/consumption_tax/01.htm';

/** Our implementation suggestions derived from official sources; reviewed 2026-09-06. */
export const lawGuidance: Readonly<Record<string, Readonly<Record<string, Guidance>>>> = {
  'in-dpdp': {
    'commencement-review': {
      implementation: ['Map each relevant Act section and Rule to its commencement notification before scheduling enforcement in your application.'],
      evidence: ['A dated provision-by-provision applicability and commencement review.'],
      source: 'https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf',
    },
    'notice-and-basis': {
      implementation: ['Map collected fields to purposes and permitted processing grounds.', 'Where consent applies, connect the notice, consent record, and withdrawal flow.'],
      evidence: ['Versioned notices and a tested consent-withdrawal flow.'], source: dpdpAct,
    },
    'rights-and-retention': {
      implementation: ['Provide reviewed access, correction, erasure, and grievance request workflows.', 'Connect approved erasure decisions to stored data and relevant processors.'],
      evidence: ['Request handling tests and a reviewed retention schedule.'], source: dpdpAct,
    },
    'security-and-children': {
      implementation: ['Review security safeguards, breach response, child-data processing, and transfer requirements against the applicable Rules and commencement dates.'],
      evidence: ['Incident-response procedures and a documented child-data and transfer review.'], source: dpdpRules,
    },
  },
  'us-ccpa': {
    notices: {
      implementation: ['Show the applicable notice when collecting data and maintain an accessible privacy policy.'],
      evidence: ['Notice locations, policy versions, and collection-flow tests.'], source: ccpa,
    },
    'consumer-rights': {
      implementation: ['Implement request intake, appropriate identity verification, and access, correction, and deletion handling, including reviewed exceptions.'],
      evidence: ['Request lifecycle tests and exception decisions.'], source: ccpa,
    },
    'opt-out': {
      implementation: ['Honor applicable sale/sharing opt-outs, including Global Privacy Control, across affected integrations.', 'Review sensitive-information restrictions separately.'],
      evidence: ['Opt-out propagation tests for affected SDKs and processors.'], source: ccpa,
    },
  },
  'us-coppa': {
    'audience-review': {
      implementation: ['Review child-directed features, actual knowledge, and collection by embedded services.'],
      evidence: ['Audience assessment and SDK inventory.'], source: coppa,
    },
    'parental-consent': {
      implementation: ['Connect parental notices and verifiable consent to collection controls; document any exception used.'],
      evidence: ['Consent-flow tests and notice versions.'], source: coppa,
    },
    'parental-rights': {
      implementation: ['Provide verified parental review, revocation, and deletion workflows.'],
      evidence: ['Parental-request tests and deletion records.'], source: coppa,
    },
    'third-party-consent': {
      implementation: ['Separate consent for third-party disclosures unless the disclosure is integral to the service; review that exception.'],
      evidence: ['Consent choices and third-party disclosure tests.'], source: coppa,
    },
    'retention-policy': {
      implementation: ['Document collection purposes, retention needs, and deletion timeframes; implement scheduled deletion.'],
      evidence: ['Written retention policy and deletion-job tests.'], source: coppa,
    },
  },
  'jp-appi': {
    'purpose-notice': {
      implementation: ['Associate collected data with specified use purposes and the applicable notice or publication.'],
      evidence: ['Purpose inventory and notice versions.'], source: appi,
    },
    'security-rights': {
      implementation: ['Implement safeguards and incident escalation, plus applicable disclosure, correction, and cessation workflows.'],
      evidence: ['Request tests and a reviewed incident-response procedure.'], source: appi,
    },
    'third-parties': {
      implementation: ['Inventory recipients and destination countries; review consent, exceptions, transfer information, and records before enabling disclosures.'],
      evidence: ['Transfer register and reviewed recipient arrangements.'],
      source: 'https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/',
    },
  },
  'in-tax-review': {
    registration: {
      implementation: ['Record the registration and place-of-supply determination before enabling GST collection.'],
      evidence: ['Registration decision and reviewed supply treatment.'], source: gst,
    },
    classification: {
      implementation: ['Keep the reviewed HSN/SAC classification, rate notification, and relevant dates with tax configuration.'],
      evidence: ['Classification and rate-source records.'], source: gst,
    },
    'invoices-and-filings': {
      implementation: ['Map applicable Rule 46 invoice particulars into your invoice schema and validate required fields.', 'Review special invoice and filing requirements separately.'],
      evidence: ['Invoice fixtures linked to the applicable Rule 46 particulars.'],
      source: 'https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001',
    },
  },
  'us-tax-review': {
    registration: {
      implementation: ['Record nexus, registration, and exemption decisions for each relevant state. This source covers California only.'],
      evidence: ['State-specific registration decisions and supporting authority links.'], source: californiaTax,
    },
    classification: {
      implementation: ['For California, verify the applicable combined rate for the transaction location and date.', 'Use the relevant state authority for other states.'],
      evidence: ['Jurisdiction, rate, effective dates, and lookup source.'],
      source: 'https://www.cdtfa.ca.gov/taxes-and-fees/know-your-rate.htm',
    },
    'invoices-and-filings': {
      implementation: ['Preserve sales and exemption records and reconcile them to the applicable returns; check each state separately.'],
      evidence: ['Transaction exports and a reviewed filing schedule.'], source: californiaTax,
    },
  },
  'jp-tax-review': {
    registration: {
      implementation: ['Review taxable-person status, exceptions, and invoice-registration requirements for the business.'],
      evidence: ['Dated status determination and registration records.'], source: japanTax,
    },
    classification: {
      implementation: ['Review which supplies qualify for the standard or reduced rate before choosing the calculation category.'],
      evidence: ['Product classifications and their authority references.'], source: japanTax,
    },
    'invoices-and-filings': {
      implementation: ['For a qualified invoice, group amounts by tax rate and round the tax once per rate.', 'Do not sum independently rounded line taxes; review remaining invoice particulars and filing rules separately.'],
      evidence: ['Mixed-rate invoice fixtures and a test that distinguishes grouped from per-line rounding.'],
      source: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm',
    },
  },
};
