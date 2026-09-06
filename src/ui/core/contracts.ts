import { createReport, fingerprint } from './report';
import type { AuditOptions, AuditReport, Finding } from './types';
export interface UIRequirement {
  selector: string;
  description: string;
  minCount?: number;
}
export interface UIContract {
  name: string;
  states: Record<string, { required: UIRequirement[] }>;
}
export interface StateObservation { visibleCounts: Record<string, number> }
export function defineContract<T extends UIContract>(contract: T): T {
  if (!contract.name.trim() || !Object.keys(contract.states).length) throw new Error('A contract needs a name and at least one state.');
  for (const [state, spec] of Object.entries(contract.states)) {
    if (!state.trim() || !spec.required.length) throw new Error('Each state needs a name and at least one required UI element.');
    for (const requirement of spec.required) {
      if (!requirement.selector.trim() || !requirement.description.trim()) throw new Error('Requirements need a selector and description.');
      if (requirement.minCount !== undefined && (!Number.isInteger(requirement.minCount) || requirement.minCount < 1)) throw new Error('minCount must be a positive integer.');
    }
  }
  return contract;
}
export function checkContract(contract: UIContract, observations: Record<string, StateObservation>, options: AuditOptions = {}): AuditReport {
  defineContract(contract);
  for (const state of Object.keys(observations)) if (!Object.hasOwn(contract.states, state)) throw new Error(`Unknown observed state: ${state}`);
  const findings: Finding[] = [];
  for (const [state, spec] of Object.entries(contract.states)) {
    const observation = Object.hasOwn(observations, state) ? observations[state] : undefined;
    if (!observation) {
      const ruleId = 'contract/untested-state';
      const target = `${contract.name}/${state}`;
      findings.push({ fingerprint: fingerprint(ruleId, target), ruleId, target, severity: 'warning', confidence: 'high', category: 'ux', message: `The ${state} state has not been observed.`, evidence: { state }, suggestion: 'Add a scenario that enters this state. Untested does not mean the UI is missing.' });
      continue;
    }
    for (const required of spec.required) {
      const count = Object.hasOwn(observation.visibleCounts, required.selector) ? observation.visibleCounts[required.selector] : undefined;
      if (count === undefined || !Number.isInteger(count) || count < 0) throw new Error(`Missing or invalid observation for ${state}: ${required.selector}`);
      if (count < (required.minCount ?? 1)) {
        const ruleId = 'contract/missing-ui';
        const target = `${contract.name}/${state} ${required.selector}`;
        findings.push({ fingerprint: fingerprint(ruleId, target), ruleId, target, severity: 'error', confidence: 'high', category: 'ux', message: `Missing required UI: ${required.description}.`, evidence: { state, selector: required.selector, expected: required.minCount ?? 1, observed: count }, suggestion: `Render ${required.description} in the ${state} state, or revise the contract if the product requirement changed.` });
      }
    }
  }
  return createReport(`contract:${contract.name}`, findings, { rules: ['contract/untested-state', 'contract/missing-ui'], elements: 0, limitations: ['Contracts verify declared visible elements in supplied scenarios; they do not prove the behavior or usefulness of those elements.'] }, options);
}
