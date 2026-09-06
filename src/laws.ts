import { getCountry, resolveCountry } from './countries';
import type { CountryCode } from './countries';
import { dateOnly, freeze, isoInstant } from './internal';

export type LawTopic = 'privacy' | 'children' | 'tax';
export type AppFact = 'collectsPersonalData' | 'servesChildrenUnder13' | 'ccpaApplies' | 'sellsTaxableItems';
export interface AppContext {
  country: string;
  /** Omitted facts remain unknown, rather than being assumed false. */
  facts?: Partial<Record<AppFact, boolean>>;
  on?: string;
}
export interface LawRule {
  readonly id: string;
  readonly country: CountryCode;
  readonly title: string;
  readonly topic: LawTopic;
  readonly jurisdiction: string;
  readonly summary: string;
  readonly scope: string;
  readonly source: string;
  readonly reviewedOn: string;
  readonly effectiveFrom?: string;
  /** Exclusive end date. Missing does not guarantee that a rule remains current. */
  readonly effectiveTo?: string;
  readonly timing: string;
  readonly when: readonly AppFact[];
  readonly controls: readonly { readonly id: string; readonly title: string }[];
}

export const lawRules: readonly LawRule[] = freeze([
  {
    id: 'in-dpdp', country: 'IN', title: 'Digital Personal Data Protection framework', topic: 'privacy', jurisdiction: 'India',
    summary: 'Plan notice, lawful processing, rights handling, safeguards, and child-data controls for digital personal data.',
    scope: 'Applicability, exemptions, and the commencement of each provision require review. This planning checklist is not a statement that every obligation is already in force.',
    source: 'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025',
    reviewedOn: '2026-09-06', timing: 'Phased commencement under November 2025 notifications; consult the linked enforcement timeline for each obligation.',
    when: ['collectsPersonalData'],
    controls: [
      { id: 'commencement-review', title: 'Record applicable provisions, exemptions, and their commencement dates' },
      { id: 'notice-and-basis', title: 'Document processing purposes, notices, consent or other permitted grounds, and withdrawal' },
      { id: 'rights-and-retention', title: 'Implement applicable access, correction, erasure, grievance, and retention workflows' },
      { id: 'security-and-children', title: 'Review safeguards, breach response, child-data requirements, and transfers' },
    ],
  },
  {
    id: 'us-ccpa', country: 'US', title: 'CCPA, as amended by CPRA', topic: 'privacy', jurisdiction: 'California',
    summary: 'Covered businesses must support applicable California privacy rights and disclosures.',
    scope: 'Set ccpaApplies only after reviewing business thresholds, California nexus, definitions, and exemptions. This is not a complete survey of US state privacy laws.',
    source: 'https://oag.ca.gov/privacy/ccpa', reviewedOn: '2026-09-06', timing: 'Current framework; review amendments and regulations for the processing date.',
    when: ['collectsPersonalData', 'ccpaApplies'],
    controls: [
      { id: 'notices', title: 'Provide applicable notices at collection and a current privacy policy' },
      { id: 'consumer-rights', title: 'Implement verified access, correction, deletion, and other applicable rights workflows' },
      { id: 'opt-out', title: 'Implement applicable sale/sharing opt-outs, Global Privacy Control, and sensitive-data restrictions' },
    ],
  },
  {
    id: 'us-coppa', country: 'US', title: 'Children’s Online Privacy Protection Rule', topic: 'children', jurisdiction: 'United States — federal',
    summary: 'Review protections for personal information collected by child-directed services or services with actual knowledge of users under 13.',
    scope: 'Review the FTC audience and actual-knowledge tests before setting servesChildrenUnder13. Exceptions and the amended rule require separate review.',
    source: 'https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business', reviewedOn: '2026-09-06',
    timing: 'Review the current amended COPPA Rule and its compliance dates.', when: ['collectsPersonalData', 'servesChildrenUnder13'],
    controls: [
      { id: 'audience-review', title: 'Assess child-directed content and actual knowledge of users under 13' },
      { id: 'parental-consent', title: 'Implement required parental notices and verifiable consent, accounting for exceptions' },
      { id: 'parental-rights', title: 'Support parental review/deletion and appropriate security and retention controls' },
    ],
  },
  {
    id: 'jp-appi', country: 'JP', title: 'Act on the Protection of Personal Information', topic: 'privacy', jurisdiction: 'Japan',
    summary: 'Review purpose specification, data handling safeguards, individual rights, and third-party disclosures under APPI.',
    scope: 'Applicability, data categories, exceptions, and overseas transfers depend on the processing arrangement. The Japanese legal text controls.',
    source: 'https://www.ppc.go.jp/en/legal/', reviewedOn: '2026-09-06', timing: 'Use current APPI text and PPC guidance for the processing date.', when: ['collectsPersonalData'],
    controls: [
      { id: 'purpose-notice', title: 'Specify use purposes and provide required notices or disclosures' },
      { id: 'security-rights', title: 'Implement appropriate safeguards, incident response, and applicable individual rights' },
      { id: 'third-parties', title: 'Review consent, records, and safeguards for third-party and overseas transfers' },
    ],
  },
  ...(['IN', 'US', 'JP'] as const).map((country): LawRule => ({
    id: `${country.toLowerCase()}-tax-review`, country, title: ({ IN: 'GST obligations review', US: 'Sales and use tax obligations review', JP: 'Consumption tax obligations review' })[country],
    topic: 'tax', jurisdiction: getCountry(country).name,
    summary: 'Determine tax registration, supply classification, invoicing, and filing obligations before enabling collection.',
    scope: 'This checklist identifies review work; it does not determine tax liability or registration thresholds.',
    source: ({ IN: 'https://taxinformation.cbic.gov.in/', US: 'https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm', JP: 'https://www.nta.go.jp/english/taxes/consumption_tax/index.htm' })[country],
    reviewedOn: '2026-09-06', timing: 'Verify rules for the supply date. US source is a California example; consult each applicable state authority.', when: ['sellsTaxableItems'],
    controls: [
      { id: 'registration', title: 'Determine registration, nexus or place of supply, and applicable exemptions' },
      { id: 'classification', title: 'Verify rates and product/service classifications against the relevant authority' },
      { id: 'invoices-and-filings', title: 'Implement required invoices, records, rounding, returns, and remittances' },
    ],
  })),
]);

export type ReviewStatus = 'todo' | 'in-progress' | 'done' | 'not-applicable';
export interface ControlRecord {
  readonly ruleId: string;
  readonly controlId: string;
  readonly status: ReviewStatus;
  readonly note: string;
  readonly updatedAt: string;
}

function validateRule(rule: LawRule) {
  if (!rule.id?.trim() || !rule.title?.trim() || !rule.scope?.trim() || !rule.timing?.trim()) throw new TypeError('Law id, title, scope, and timing are required');
  if (getCountry(rule.country).code !== rule.country) throw new RangeError('Law country must be IN, US, or JP');
  if (!['privacy', 'children', 'tax'].includes(rule.topic)) throw new RangeError('Unknown law topic');
  if (!rule.source.startsWith('https://')) throw new TypeError('Law source must be an HTTPS URL');
  new URL(rule.source); dateOnly(rule.reviewedOn);
  if (rule.effectiveFrom !== undefined) dateOnly(rule.effectiveFrom);
  if (rule.effectiveTo !== undefined) dateOnly(rule.effectiveTo);
  if (rule.effectiveFrom && rule.effectiveTo && rule.effectiveTo <= rule.effectiveFrom) throw new RangeError('effectiveTo must follow effectiveFrom');
  if (!Array.isArray(rule.when) || rule.when.some(fact => !['collectsPersonalData', 'servesChildrenUnder13', 'ccpaApplies', 'sellsTaxableItems'].includes(fact))) throw new RangeError('Unknown applicability fact');
  const ids = new Set<string>();
  if (!Array.isArray(rule.controls) || !rule.controls.length) throw new TypeError('At least one control is required');
  for (const control of rule.controls) {
    if (!control.id?.trim() || !control.title?.trim() || ids.has(control.id)) throw new RangeError('Control IDs must be nonempty and unique within a law');
    ids.add(control.id);
  }
}

/** In-memory review workflow; persist exportRecords() in your own database. */
export function createLawsManager(options: { rules?: readonly LawRule[]; records?: readonly ControlRecord[] } = {}) {
  const rules = new Map<string, LawRule>();
  const records = new Map<string, ControlRecord>();
  const key = (ruleId: string, controlId: string) => JSON.stringify([ruleId, controlId]);
  const register = (rule: LawRule) => {
    validateRule(rule);
    if (rules.has(rule.id)) throw new RangeError(`Duplicate law rule: ${rule.id}`);
    rules.set(rule.id, freeze({ ...rule, when: [...rule.when], controls: rule.controls.map(control => ({ ...control })) }));
  };
  const record = (input: ControlRecord) => {
    if (!rules.get(input.ruleId)?.controls.some(control => control.id === input.controlId)) throw new RangeError('Unknown law or control');
    if (!['todo', 'in-progress', 'done', 'not-applicable'].includes(input.status)) throw new RangeError('Unknown review status');
    if (typeof input.note !== 'string' || (['done', 'not-applicable'].includes(input.status) && !input.note.trim())) throw new TypeError('A review note or evidence reference is required for done/not-applicable');
    isoInstant(input.updatedAt);
    records.set(key(input.ruleId, input.controlId), freeze({ ...input }));
  };
  (options.rules ?? lawRules).forEach(register);
  options.records?.forEach(record);
  const list = (filter: { country?: string; topic?: LawTopic } = {}) => {
    const country = filter.country === undefined ? undefined : resolveCountry(filter.country);
    if (filter.topic !== undefined && !['privacy', 'children', 'tax'].includes(filter.topic)) throw new RangeError('Unknown law topic');
    return Object.freeze([...rules.values()].filter(rule => (!country || rule.country === country) && (!filter.topic || rule.topic === filter.topic)));
  };
  return Object.freeze({
    register, list, record,
    exportRecords: () => Object.freeze([...records.values()]),
    assess(context: AppContext) {
      const on = dateOnly(context.on ?? new Date().toISOString().slice(0, 10));
      const facts = context.facts ?? {};
      for (const [fact, value] of Object.entries(facts)) {
        if (!['collectsPersonalData', 'servesChildrenUnder13', 'ccpaApplies', 'sellsTaxableItems'].includes(fact) || typeof value !== 'boolean') throw new TypeError(`Invalid app fact: ${fact}`);
      }
      const items = list({ country: context.country }).map(rule => {
        const applicability = rule.when.some(fact => facts[fact] === false) ? 'not-indicated' : rule.when.some(fact => facts[fact] === undefined) ? 'needs-context' : 'review-required';
        const timing = rule.effectiveFrom && on < rule.effectiveFrom ? 'upcoming' : rule.effectiveTo && on >= rule.effectiveTo ? 'outside-period' : rule.effectiveFrom ? 'within-period' : 'verify-commencement';
        return {
          rule, applicability, timing,
          sourceReviewRequired: on !== rule.reviewedOn,
          missingFacts: rule.when.filter(fact => facts[fact] === undefined),
          controls: rule.controls.map(control => ({ ...control, record: records.get(key(rule.id, control.id)) ?? null })),
        };
      });
      return freeze({ country: resolveCountry(context.country), on, scope: 'Selected developer checklists, not exhaustive legal coverage or a compliance certification.', items });
    },
  });
}
