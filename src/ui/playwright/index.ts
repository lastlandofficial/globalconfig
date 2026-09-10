import type { Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { collectSnapshot, type CollectOptions } from '../browser/collect';
import { auditSnapshot } from '../core/engine';
import { createReport, fingerprint, formatReport, shouldFail } from '../core/report';
import { checkContract, defineContract, type StateObservation, type UIContract } from '../core/contracts';
import type { AuditOptions, AuditReport, Finding, Severity } from '../core/types';
export interface PageAuditOptions extends AuditOptions, CollectOptions {
  accessibility?: boolean;
  /** Wait for your app's readiness marker rather than an arbitrary delay. */
  readySelector?: string;
  timeout?: number;
}
export async function auditPage(page: Page, options: PageAuditOptions = {}): Promise<AuditReport> {
  // DOMContentLoaded can precede stylesheet completion and produce false size findings.
  await page.waitForLoadState('load', { timeout: options.timeout ?? 10000 });
  if (options.readySelector) await page.locator(options.readySelector).waitFor({ state: 'visible', timeout: options.timeout ?? 10000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  const snapshot = await page.evaluate(collectSnapshot, options.maxElements === undefined ? {} : { maxElements: options.maxElements });
  // Apply configuration once after combining engines, so suppression accounting is retained.
  const report = auditSnapshot(snapshot, { ...options, suppressions: [] });
  if (options.accessibility === false) {
    report.coverage.limitations.push('axe accessibility checks were disabled.');
  } else {
    let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);
    const disabled = Object.entries(options.rules ?? {}).filter(([id, value]) => id.startsWith('axe/') && value === 'off').map(([id]) => id.slice(4));
    if (disabled.length) builder = builder.disableRules(disabled);
    const result = await builder.analyze();
    report.coverage.rules.push(...new Set([...result.passes, ...result.violations, ...result.incomplete, ...result.inapplicable].map(rule => `axe/${rule.id}`)));
    for (const violation of result.violations) {
      for (const node of violation.nodes) {
        const ruleId = `axe/${violation.id}`;
        const target = JSON.stringify(node.target);
        const severity: Severity = violation.impact === 'minor' ? 'warning' : 'error';
        report.findings.push({ fingerprint: fingerprint(ruleId, target), ruleId, severity, confidence: 'high', category: 'accessibility', message: violation.help, target,
          evidence: { impact: violation.impact ?? 'unknown', checks: [...node.any, ...node.all, ...node.none].map(check => check.id) }, suggestion: violation.description, helpUrl: violation.helpUrl });
      }
    }
    for (const incomplete of result.incomplete) report.coverage.limitations.push(`Manual review required: axe/${incomplete.id} (${incomplete.nodes.length} nodes). ${incomplete.helpUrl}`);
  }
  return createReport(report.source, report.findings, report.coverage, options);
}

/** Executes only scenarios supplied by the developer. Each setup must enter a settled state. */
export async function auditStates<T extends UIContract>(page: Page, contract: T, scenarios: Partial<Record<keyof T['states'], (page: Page) => Promise<void>>>, options: AuditOptions = {}): Promise<AuditReport> {
  defineContract(contract);
  for (const state of Object.keys(scenarios)) if (!Object.hasOwn(contract.states, state)) throw new Error(`Unknown scenario state: ${state}`);
  const observations: Record<string, StateObservation> = Object.create(null);
  for (const [state, spec] of Object.entries(contract.states)) {
    const setup = Object.hasOwn(scenarios, state) ? scenarios[state] : undefined;
    if (!setup) continue;
    await setup(page);
    const visibleCounts: Record<string, number> = Object.create(null);
    for (const requirement of spec.required) {
      const elements = await page.locator(requirement.selector).all();
      const visibility = await Promise.all(elements.map(element => element.isVisible()));
      visibleCounts[requirement.selector] = visibility.filter(Boolean).length;
    }
    observations[state] = { visibleCounts };
  }
  return checkContract(contract, observations, options);
}
export const matchers = {
  toHaveNoUIIssues(report: AuditReport, threshold: Severity | 'none' = 'error') {
    const pass = !shouldFail(report, threshold);
    return { pass, message: () => pass ? `Expected UI issues at threshold ${threshold}, but none were found.` : formatReport(report) };
  },
};
export function assertUI(report: AuditReport, threshold: Severity | 'none' = 'error'): void {
  if (shouldFail(report, threshold)) throw new Error(formatReport(report));
}
export type { AuditReport, Finding };
