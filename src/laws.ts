import { digest } from './compliance/rules';
import { getCountry, resolveCountry } from './countries';
import type { CountryCode } from './countries';
import { dateOnly, freeze, isoInstant } from './internal';
import { lawGuidance } from './law-guidance';

export type LawTopic = 'privacy' | 'children' | 'tax';
export type AppFact = 'collectsPersonalData' | 'servesChildrenUnder13' | 'ccpaApplies' | 'sellsTaxableItems';
/** Questions for application owners; an unanswered question stays unknown. */
export const appFacts: Readonly<Record<AppFact, { readonly question: string; readonly help: string }>> = freeze({
  collectsPersonalData: {
    question: 'Does your service collect or handle personal data?',
    help: 'Review account fields, logs, identifiers, analytics, and data collected through third-party SDKs.',
  },
  servesChildrenUnder13: {
    question: 'Does your service meet the COPPA child-directed or actual-knowledge tests?',
    help: 'Review the FTC audience criteria and third-party collection. A terms-of-service age limit alone does not settle this question.',
  },
  ccpaApplies: {
    question: 'Has your business been determined to fall within CCPA scope?',
    help: 'Review California connections, current business thresholds, definitions, and exemptions before answering.',
  },
  sellsTaxableItems: {
    question: 'Do you sell goods or services that may be taxable in this jurisdiction?',
    help: 'Review product classification and supply location; registration and collection obligations need a separate determination.',
  },
});

export interface LawControl {
  readonly id: string;
  readonly title: string;
  /** Developer implementation suggestions, rather than verbatim legal requirements. */
  readonly implementation?: readonly string[];
  /** Suggested review artifacts; these do not prove legal compliance. */
  readonly evidence?: readonly string[];
  /** More specific official source; falls back to the rule source when omitted. */
  readonly source?: string;
}
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
  readonly reviewAfter?: string;
  readonly revision?: string;
  readonly effectiveFrom?: string;
  /** Exclusive end date. Missing does not guarantee that a rule remains current. */
  readonly effectiveTo?: string;
  readonly timing: string;
  readonly when: readonly AppFact[];
  readonly controls: readonly LawControl[];
}

export const lawRules: readonly LawRule[] = freeze(([
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
      { id: 'third-party-consent', title: 'Review separate parental consent for third-party disclosures' },
      { id: 'retention-policy', title: 'Maintain a written retention and deletion policy for child data' },
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
] satisfies LawRule[]).map(rule => ({
  ...rule,
  controls: rule.controls.map(control => ({ ...control, ...lawGuidance[rule.id]?.[control.id] })),
})));

export type ReviewStatus = 'todo' | 'in-progress' | 'done' | 'not-applicable';
export interface ControlRecord {
  readonly ruleId: string;
  readonly controlId: string;
  readonly status: ReviewStatus;
  readonly note: string;
  readonly updatedAt: string;
  readonly ruleRevision?: string;
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
  if (!Array.isArray(rule.when) || rule.when.some(fact => !Object.hasOwn(appFacts, fact))) throw new RangeError('Unknown applicability fact');
  if (rule.reviewAfter !== undefined && dateOnly(rule.reviewAfter) <= rule.reviewedOn) throw new RangeError('reviewAfter must follow reviewedOn');
  if (rule.revision !== undefined && !rule.revision.trim()) throw new TypeError('revision must be non-empty');
  const ids = new Set<string>();
  if (!Array.isArray(rule.controls) || !rule.controls.length) throw new TypeError('At least one control is required');
  for (const control of rule.controls) {
    if (!control.id?.trim() || !control.title?.trim() || ids.has(control.id)) throw new RangeError('Control IDs must be nonempty and unique within a law');
    for (const field of ['implementation', 'evidence'] as const) {
      const values = control[field];
      if (values !== undefined && (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim()))) throw new TypeError(`Control ${field} must be an array of nonempty strings`);
    }
    if (control.source !== undefined) {
      if (typeof control.source !== 'string' || new URL(control.source).protocol !== 'https:') throw new TypeError('Control source must be an HTTPS URL');
    }
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
    rules.set(rule.id, freeze({ ...rule, when: [...rule.when], controls: rule.controls.map(control => ({
      ...control,
      ...(control.implementation === undefined ? {} : { implementation: [...control.implementation] }),
      ...(control.evidence === undefined ? {} : { evidence: [...control.evidence] }),
    })) }));
  };
  const revisionOf = (rule: LawRule) => rule.revision ?? digest(JSON.parse(JSON.stringify(rule)));
  const record = (input: ControlRecord, restoring = false) => {
    if (!rules.get(input.ruleId)?.controls.some(control => control.id === input.controlId)) throw new RangeError('Unknown law or control');
    if (!['todo', 'in-progress', 'done', 'not-applicable'].includes(input.status)) throw new RangeError('Unknown review status');
    if (typeof input.note !== 'string' || (['done', 'not-applicable'].includes(input.status) && !input.note.trim())) throw new TypeError('A review note or evidence reference is required for done/not-applicable');
    isoInstant(input.updatedAt);
    if (input.ruleRevision !== undefined && (typeof input.ruleRevision !== 'string' || !input.ruleRevision.trim())) throw new TypeError('ruleRevision must be non-empty');
    records.set(key(input.ruleId, input.controlId), freeze({ ...input, ...(!restoring && input.ruleRevision === undefined ? { ruleRevision: revisionOf(rules.get(input.ruleId)!) } : {}) }));
  };
  (options.rules ?? lawRules).forEach(register);
  options.records?.forEach(input => record(input, true));
  const list = (filter: { country?: string; topic?: LawTopic } = {}) => {
    const country = filter.country === undefined ? undefined : resolveCountry(filter.country);
    if (filter.topic !== undefined && !['privacy', 'children', 'tax'].includes(filter.topic)) throw new RangeError('Unknown law topic');
    return Object.freeze([...rules.values()].filter(rule => (!country || rule.country === country) && (!filter.topic || rule.topic === filter.topic)));
  };
  const assess = (context: AppContext) => {
    const on = dateOnly(context.on ?? new Date().toISOString().slice(0, 10));
    if (context.facts !== undefined && (!context.facts || typeof context.facts !== 'object' || Array.isArray(context.facts))) throw new TypeError('App facts must be an object of boolean answers');
    const facts = context.facts ?? {};
    for (const [fact, value] of Object.entries(facts)) {
      if (!Object.hasOwn(appFacts, fact) || typeof value !== 'boolean') throw new TypeError(`Invalid app fact: ${fact}`);
    }
    const items = list({ country: context.country }).map(rule => {
      const applicability = rule.when.some(fact => facts[fact] === false) ? 'not-indicated' as const : rule.when.some(fact => facts[fact] === undefined) ? 'needs-context' as const : 'review-required' as const;
      const timing = rule.effectiveFrom && on < rule.effectiveFrom ? 'upcoming' as const : rule.effectiveTo && on >= rule.effectiveTo ? 'outside-period' as const : rule.effectiveFrom ? 'within-period' as const : 'verify-commencement' as const;
      return {
        rule, applicability, timing,
        sourceReviewRequired: rule.reviewAfter ? on >= rule.reviewAfter || on < rule.reviewedOn : on !== rule.reviewedOn,
        revision: revisionOf(rule),
        missingFacts: rule.when.filter(fact => facts[fact] === undefined),
        controls: rule.controls.map(control => { const saved = records.get(key(rule.id, control.id)); return { ...control, record: saved ?? null, recordReviewRequired: !!saved && saved.ruleRevision !== revisionOf(rule), verification: !saved ? 'not-recorded' as const : saved.ruleRevision === revisionOf(rule) ? 'recorded-for-revision' as const : 'review-required' as const }; }),
      };
    });
    return freeze({ country: resolveCountry(context.country), on, scope: 'Selected developer checklists, not exhaustive legal coverage or a compliance certification.', items });
  };
  return Object.freeze({
    register, list, record: (input: ControlRecord) => record(input), assess,
    revision(id: string) { const rule = rules.get(id); if (!rule) throw new RangeError(`Unknown law: ${id}`); return revisionOf(rule); },
    exportRecords: () => Object.freeze([...records.values()]),
    /** Turn the assessment into questions and implementation tasks with source links. */
    plan(context: AppContext) {
      const report = assess(context);
      const candidates = report.items.filter(item => item.applicability !== 'not-indicated' && item.timing !== 'outside-period');
      const missing = [...new Set(candidates.flatMap(item => item.missingFacts))];
      const questions = missing.map(fact => ({
        fact, ...appFacts[fact],
        ruleIds: candidates.filter(item => item.missingFacts.includes(fact)).map(item => item.rule.id),
        sources: [...new Set(candidates.filter(item => item.missingFacts.includes(fact)).map(item => item.rule.source))],
      }));
      const tasks = candidates.flatMap(item => item.controls.map(control => ({
        ruleId: item.rule.id, ruleTitle: item.rule.title, controlId: control.id, title: control.title,
        topic: item.rule.topic, jurisdiction: item.rule.jurisdiction,
        scope: item.rule.scope,
        applicability: item.applicability, timing: item.timing, timingNote: item.rule.timing,
        source: control.source ?? item.rule.source, reviewedOn: item.rule.reviewedOn,
        sourceReviewRequired: item.sourceReviewRequired,
        implementation: control.implementation ?? [], evidence: control.evidence ?? [],
        status: control.record?.status ?? 'todo' as const, record: control.record,
        verification: control.verification, recordReviewRequired: control.recordReviewRequired, revision: item.revision,
      })));
      const sourcesToReview = [...new Set(candidates.filter(item => item.sourceReviewRequired)
        .flatMap(item => [item.rule.source, ...item.controls.map(control => control.source ?? item.rule.source)]))];
      const count = (status: ReviewStatus) => tasks.filter(task => task.status === status).length;
      return freeze({
        country: report.country, on: report.on, scope: report.scope,
        questions, tasks, sourcesToReview,
        evidence: { recordedForRevision: tasks.filter(t => t.verification === 'recorded-for-revision').length, requiresReview: tasks.filter(t => t.recordReviewRequired).length, notRecorded: tasks.filter(t => !t.record).length },
        progress: { total: tasks.length, todo: count('todo'), inProgress: count('in-progress'), done: count('done'), notApplicable: count('not-applicable') },
      });
    },
  });
}
