import type { AuditOptions, AuditReport, Finding, Severity } from './types';

/** Stable across runs; neither timestamp nor DOM content is part of identity. */
export function fingerprint(ruleId: string, target: string): string {
  let hash = 2166136261;
  for (const char of `${ruleId}\0${target}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `glocon-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
export function createReport(source: string, findings: Finding[], coverage: AuditReport['coverage'], options: AuditOptions = {}): AuditReport {
  for (const suppression of options.suppressions ?? []) if (!suppression.reason?.trim()) throw new Error('Suppressions require a non-empty reason.');
  const suppressed: AuditReport['suppressed'] = [];
  const active: Finding[] = [];
  for (const finding of findings) {
    if (options.rules?.[finding.ruleId] === 'off') continue;
    const suppression = options.suppressions?.find(s => s.ruleId === finding.ruleId && (!s.target || s.target === finding.target));
    if (suppression) {
      if (!suppression.reason.trim()) throw new Error('Suppressions require a non-empty reason.');
      suppressed.push({ finding, reason: suppression.reason });
    } else {
      const severity = options.rules?.[finding.ruleId];
      active.push(severity && severity !== 'off' ? { ...finding, severity } : finding);
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  active.sort((a, b) => rank[a.severity] - rank[b.severity] || a.ruleId.localeCompare(b.ruleId) || a.target.localeCompare(b.target));
  const summary = { error: 0, warning: 0, info: 0, total: active.length };
  for (const finding of active) summary[finding.severity]++;
  return { schemaVersion: '1.0', engineVersion: '0.1.0', source, findings: active, suppressed, summary, coverage };
}
export function shouldFail(report: AuditReport, threshold: Severity | 'none' = 'error'): boolean {
  const rank = { error: 0, warning: 1, info: 2 };
  return threshold !== 'none' && report.findings.some(f => rank[f.severity] <= rank[threshold]);
}
export function formatReport(report: AuditReport): string {
  const lines = [`glocon · ${report.source}`, `${report.summary.error} errors · ${report.summary.warning} warnings · ${report.summary.info} suggestions`];
  for (const f of report.findings) lines.push(`\n${f.severity.toUpperCase()} ${f.ruleId} [${f.confidence}]`, `  ${f.target}: ${f.message}`, `  Fix: ${f.suggestion}`);
  if (report.suppressed.length) lines.push(`\n${report.suppressed.length} findings suppressed with a reason.`);
  lines.push(`\nCoverage: ${report.coverage.rules.length} rules; ${report.coverage.elements} elements.`);
  for (const limit of report.coverage.limitations) lines.push(`  Limit: ${limit}`);
  return lines.join('\n');
}
