import { rules } from './rules';
import { createReport, fingerprint } from './report';
import type { AuditOptions, AuditReport, Finding, Rule, UISnapshot } from './types';
export { rules } from './rules';

export function auditSnapshot(snapshot: UISnapshot, options: AuditOptions = {}, customRules: Rule[] = []): AuditReport {
  if (options.targetSize !== undefined && (!Number.isFinite(options.targetSize) || options.targetSize <= 0)) throw new Error('targetSize must be a positive finite number.');
  if (options.spacingTolerance !== undefined && (!Number.isFinite(options.spacingTolerance) || options.spacingTolerance < 0)) throw new Error('spacingTolerance must be a non-negative finite number.');
  if (options.spacingScale?.some(n => !Number.isFinite(n) || n < 0)) throw new Error('spacingScale must contain non-negative finite numbers.');
  const allRules = [...rules, ...customRules];
  const ids = allRules.map(r => r.meta.id);
  if (new Set(ids).size !== ids.length) throw new Error('Rule IDs must be unique.');
  for (const [id, severity] of Object.entries(options.rules ?? {})) {
    if (!ids.includes(id) && !id.startsWith('axe/') && !id.startsWith('contract/')) throw new Error(`Unknown rule: ${id}`);
    if (!['error', 'warning', 'info', 'off'].includes(severity)) throw new Error(`Invalid severity for ${id}`);
  }
  for (const suppression of options.suppressions ?? []) if (!suppression.reason?.trim()) throw new Error('Suppressions require a non-empty reason.');
  const findings: Finding[] = [];
  const executed: string[] = [];
  for (const rule of allRules) {
    if (options.rules?.[rule.meta.id] === 'off' || (snapshot.platform === 'web' && rule.meta.id.startsWith('native/'))) continue;
    if (rule.meta.id === 'consistency/spacing' && !options.spacingScale?.length) continue;
    executed.push(rule.meta.id);
    for (const result of rule.check(snapshot, options)) {
      const element = snapshot.elements.find(e => e.target === result.target);
      if (element?.ignore.includes(rule.meta.id)) continue;
      findings.push({ ...result, fingerprint: fingerprint(rule.meta.id, result.target), ruleId: rule.meta.id, severity: rule.meta.severity, confidence: rule.meta.confidence, category: rule.meta.category, ...(rule.meta.helpUrl ? { helpUrl: rule.meta.helpUrl } : {}) });
    }
  }
  return createReport(snapshot.url ?? snapshot.platform, findings, {
    rules: executed,
    elements: snapshot.elements.length,
    limitations: [...(snapshot.limitations ?? []), 'Checks cover only the supplied state and viewport. A clean report is not a usability or accessibility certification.', 'Visual taste, task success, reading order, and interaction flows require human review or explicit scenario tests.'],
  }, options);
}
