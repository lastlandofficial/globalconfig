import type { Page } from "playwright";
import { collectSnapshot, type CollectOptions } from "../browser/collect";
import { auditSnapshot } from "../core/engine";
import {
  createReport,
  fingerprint,
  formatReport,
  shouldFail,
  validateAuditOptions,
} from "../core/report";
import {
  checkContract,
  defineContract,
  type StateObservation,
  type UIContract,
} from "../core/contracts";
import type {
  AuditOptions,
  AuditReport,
  Finding,
  Severity,
} from "../core/types";
import { createDeadline } from "./deadline";
import { createAxePageScope } from "./axe-scope";
export interface PageAuditOptions extends AuditOptions, CollectOptions {
  accessibility?: boolean;
  /** Electron cannot open axe's aggregation target. Same-origin mode excludes cross-origin frames. */
  accessibilityMode?: "standard" | "same-origin";
  /** Wait for your app's readiness marker rather than an arbitrary delay. */
  readySelector?: string;
  /** Total readiness, collection and accessibility budget, in milliseconds. */
  timeout?: number;
}
export async function auditPage(
  page: Page,
  options: PageAuditOptions = {},
): Promise<AuditReport> {
  validateAuditOptions(options);
  if (
    options.accessibilityMode !== undefined &&
    !["standard", "same-origin"].includes(options.accessibilityMode)
  )
    throw new TypeError("Unknown accessibilityMode");
  const deadline = createDeadline(options.timeout ?? 10000, "Page audit");
  // DOMContentLoaded can precede stylesheet completion and produce false size findings.
  await deadline.run("page load", () =>
    page.waitForLoadState("load", { timeout: deadline.remaining("page load") }),
  );
  const readySelector = options.readySelector;
  if (readySelector)
    await deadline.run("readiness selector", () =>
      page.locator(readySelector).waitFor({
        state: "visible",
        timeout: deadline.remaining("readiness selector"),
      }),
    );
  await deadline.run("font readiness", () =>
    page.evaluate(async () => {
      await document.fonts.ready;
    }),
  );
  const snapshot = await deadline.run("snapshot collection", () =>
    page.evaluate(
      collectSnapshot,
      options.maxElements === undefined
        ? {}
        : { maxElements: options.maxElements },
    ),
  );
  // Apply configuration once after combining engines, so suppression accounting is retained.
  const report = auditSnapshot(snapshot, { ...options, suppressions: [] });
  if (options.accessibility === false) {
    report.coverage.limitations.push("axe accessibility checks were disabled.");
  } else {
    const { default: AxeBuilder } = await deadline.run(
      "accessibility setup",
      () =>
        import("@axe-core/playwright").catch(() => {
          throw new Error(
            "Accessibility checks require @axe-core/playwright. Add it with your package manager, or run glocon init --ui.",
          );
        }),
    );
    const axePages = createAxePageScope(page);
    let builder = new AxeBuilder({ page: axePages.page }).withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ]);
    if (options.accessibilityMode === "same-origin") {
      builder = builder.setLegacyMode(true);
      report.coverage.limitations.push(
        "Same-origin accessibility mode does not test cross-origin frames; axe/frame-tested identifies untested frames. Use standard mode where opening an aggregation page is supported.",
      );
    }
    const disabled = Object.entries(options.rules ?? {})
      .filter(([id, value]) => id.startsWith("axe/") && value === "off")
      .map(([id]) => id.slice(4));
    if (disabled.length) builder = builder.disableRules(disabled);
    const result = await (async () => {
      try {
        return await deadline.run("accessibility checks", () =>
          builder.analyze(),
        );
      } finally {
        await axePages.close();
      }
    })();
    report.coverage.rules.push(
      ...new Set(
        [
          ...result.passes,
          ...result.violations,
          ...result.incomplete,
          ...result.inapplicable,
        ].map((rule) => `axe/${rule.id}`),
      ),
    );
    const outcomes = (report.coverage.outcomes ??= []);
    for (const [results, status] of [
      [result.passes, "passed"],
      [result.violations, "failed"],
      [result.incomplete, "manual-review"],
    ] as const) {
      for (const rule of results) {
        if (!rule.nodes.length)
          outcomes.push({ ruleId: `axe/${rule.id}`, status });
        for (const node of rule.nodes)
          outcomes.push({
            ruleId: `axe/${rule.id}`,
            target: JSON.stringify(node.target),
            status,
          });
      }
    }
    for (const violation of result.violations) {
      for (const node of violation.nodes) {
        const ruleId = `axe/${violation.id}`;
        const target = JSON.stringify(node.target);
        const severity: Severity =
          violation.impact === "minor" ? "warning" : "error";
        report.findings.push({
          fingerprint: fingerprint(ruleId, target),
          ruleId,
          severity,
          confidence: "high",
          category: "accessibility",
          message: violation.help,
          target,
          evidence: {
            impact: violation.impact ?? "unknown",
            checks: [...node.any, ...node.all, ...node.none].map(
              (check) => check.id,
            ),
          },
          suggestion: violation.description,
          helpUrl: violation.helpUrl,
        });
      }
    }
    for (const incomplete of result.incomplete)
      report.coverage.limitations.push(
        `Manual review required: axe/${incomplete.id} (${incomplete.nodes.length} nodes). ${incomplete.helpUrl}`,
      );
  }
  const combined = createReport(
    report.source,
    report.findings,
    report.coverage,
    options,
  );
  deadline.remaining("report creation");
  return combined;
}

/** Executes only scenarios supplied by the developer. Each setup must enter a settled state. */
export async function auditStates<T extends UIContract>(
  page: Page,
  contract: T,
  scenarios: Partial<Record<keyof T["states"], (page: Page) => Promise<void>>>,
  options: AuditOptions = {},
): Promise<AuditReport> {
  validateAuditOptions(options);
  defineContract(contract);
  for (const state of Object.keys(scenarios))
    if (!Object.hasOwn(contract.states, state))
      throw new Error(`Unknown scenario state: ${state}`);
  const observations: Record<string, StateObservation> = Object.create(null);
  for (const [state, spec] of Object.entries(contract.states)) {
    const setup = Object.hasOwn(scenarios, state)
      ? scenarios[state]
      : undefined;
    if (!setup) continue;
    await setup(page);
    const visibleCounts: Record<string, number> = Object.create(null);
    for (const requirement of spec.required) {
      const elements = await page.locator(requirement.selector).all();
      const visibility = await Promise.all(
        elements.map((element) => element.isVisible()),
      );
      visibleCounts[requirement.selector] = visibility.filter(Boolean).length;
    }
    observations[state] = { visibleCounts };
  }
  return checkContract(contract, observations, options);
}
export const matchers = {
  toHaveNoUIIssues(
    report: AuditReport,
    threshold: Severity | "none" = "error",
  ) {
    const pass = !shouldFail(report, threshold);
    return {
      pass,
      message: () =>
        pass
          ? `Expected UI issues at threshold ${threshold}, but none were found.`
          : formatReport(report),
    };
  },
};
export function assertUI(
  report: AuditReport,
  threshold: Severity | "none" = "error",
): void {
  if (shouldFail(report, threshold)) throw new Error(formatReport(report));
}
export type { AuditReport, Finding };
