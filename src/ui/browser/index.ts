import { auditSnapshot } from '../core/engine';
import type { AuditOptions, AuditReport } from '../core/types';
import { collectSnapshot, type CollectOptions } from './collect';
export { collectSnapshot, type CollectOptions } from './collect';
/** Synchronous UX/layout checks. Use glocon/playwright for axe accessibility checks. */
export function auditDocument(options: AuditOptions & CollectOptions = {}): AuditReport {
  const report = auditSnapshot(collectSnapshot(options), options);
  report.coverage.limitations.push('auditDocument does not run axe. Use glocon/playwright for automated accessibility checks.');
  return report;
}
