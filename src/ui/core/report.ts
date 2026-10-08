import type { AuditOptions, AuditReport, Finding, Severity } from "./types";

const severities = ["error", "warning", "info"];

/** @internal Shared runtime validation for JavaScript and untyped configuration callers. */
export function validateAuditOptions(options: AuditOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("Audit options must be an object.");
  if (
    options.coveragePolicy !== undefined &&
    !["complete", "allow-truncated"].includes(options.coveragePolicy)
  )
    throw new Error("coveragePolicy must be complete or allow-truncated.");
  if (
    options.targetSize !== undefined &&
    (!Number.isFinite(options.targetSize) || options.targetSize <= 0)
  )
    throw new Error("targetSize must be a positive finite number.");
  if (
    options.spacingTolerance !== undefined &&
    (!Number.isFinite(options.spacingTolerance) || options.spacingTolerance < 0)
  )
    throw new Error("spacingTolerance must be a non-negative finite number.");
  if (
    options.spacingScale !== undefined &&
    (!Array.isArray(options.spacingScale) ||
      options.spacingScale.some((n) => !Number.isFinite(n) || n < 0))
  )
    throw new Error("spacingScale must contain non-negative finite numbers.");
  if (
    options.rules !== undefined &&
    (!options.rules ||
      typeof options.rules !== "object" ||
      Array.isArray(options.rules))
  )
    throw new Error("rules must map rule IDs to severities.");
  for (const [id, severity] of Object.entries(options.rules ?? {}))
    if (![...severities, "off"].includes(severity))
      throw new Error(`Invalid severity for ${id}`);
  if (
    options.suppressions !== undefined &&
    !Array.isArray(options.suppressions)
  )
    throw new Error("Suppressions must be an array.");
  for (const suppression of options.suppressions ?? []) {
    if (
      !suppression ||
      typeof suppression !== "object" ||
      typeof suppression.ruleId !== "string" ||
      !suppression.ruleId.trim()
    )
      throw new Error("Suppressions require a non-empty rule ID.");
    if (
      suppression.target !== undefined &&
      typeof suppression.target !== "string"
    )
      throw new Error("Suppression targets must be strings.");
    if (typeof suppression.reason !== "string" || !suppression.reason.trim())
      throw new Error("Suppressions require a non-empty reason.");
  }
}

/** Stable across runs; neither timestamp nor DOM content is part of identity. */
export function fingerprint(ruleId: string, target: string): string {
  let hash = 2166136261;
  const identity = `${ruleId}\0${target}`;
  for (let index = 0; index < identity.length; index++) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `glocon-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
export function createReport(
  source: string,
  findings: Finding[],
  coverage: AuditReport["coverage"],
  options: AuditOptions = {},
): AuditReport {
  validateAuditOptions(options);
  const collection = coverage.collection;
  if (
    collection &&
    (!Number.isSafeInteger(collection.total) ||
      !Number.isSafeInteger(collection.inspected) ||
      collection.total < 0 ||
      collection.inspected < 0 ||
      collection.inspected > collection.total ||
      typeof collection.truncated !== "boolean" ||
      collection.truncated !== collection.inspected < collection.total)
  )
    throw new Error(
      "Collection metadata must contain consistent total, inspected and truncated measurements.",
    );
  const suppressed: AuditReport["suppressed"] = [];
  const active: Finding[] = [];
  for (const finding of findings) {
    if (!severities.includes(finding.severity))
      throw new Error(`Invalid finding severity for ${finding.ruleId}`);
    if (options.rules?.[finding.ruleId] === "off") continue;
    const suppression = options.suppressions?.find(
      (s) =>
        s.ruleId === finding.ruleId &&
        (!s.target || s.target === finding.target),
    );
    if (suppression) {
      if (!suppression.reason.trim())
        throw new Error("Suppressions require a non-empty reason.");
      suppressed.push({ finding, reason: suppression.reason });
    } else {
      const severity = options.rules?.[finding.ruleId];
      active.push(
        severity && severity !== "off" ? { ...finding, severity } : finding,
      );
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  active.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.target.localeCompare(b.target),
  );
  const summary = { error: 0, warning: 0, info: 0, total: active.length };
  for (const finding of active) summary[finding.severity]++;
  const complete =
    coverage.complete !== false &&
    !coverage.collection?.truncated &&
    !coverage.limitations.some((limit) =>
      limit.startsWith("DOM collection truncated"),
    );
  return {
    schemaVersion: "1.0",
    engineVersion: "0.2.0",
    source,
    findings: active,
    suppressed,
    summary,
    coverage: {
      ...coverage,
      complete,
      acceptedIncomplete:
        !complete && options.coveragePolicy === "allow-truncated",
    },
  };
}
export function shouldFail(
  report: AuditReport,
  threshold: Severity | "none" = "error",
): boolean {
  if (![...severities, "none"].includes(threshold))
    throw new Error("threshold must be error, warning, info or none.");
  for (const finding of report.findings)
    if (!severities.includes(finding.severity))
      throw new Error(`Invalid finding severity for ${finding.ruleId}`);
  const rank = { error: 0, warning: 1, info: 2 };
  return (
    (report.coverage.complete === false &&
      !report.coverage.acceptedIncomplete) ||
    (threshold !== "none" &&
      report.findings.some((f) => rank[f.severity] <= rank[threshold]))
  );
}
export function formatReport(report: AuditReport): string {
  const lines = [
    `glocon · ${report.source}`,
    `${report.summary.error} errors · ${report.summary.warning} warnings · ${report.summary.info} suggestions`,
  ];
  for (const f of report.findings)
    lines.push(
      `\n${f.severity.toUpperCase()} ${f.ruleId} [${f.confidence}]`,
      `  ${f.target}: ${f.message}`,
      `  Fix: ${f.suggestion}`,
    );
  if (report.suppressed.length)
    lines.push(
      `\n${report.suppressed.length} findings suppressed with a reason.`,
    );
  lines.push(
    `\nCoverage: ${report.coverage.rules.length} rules; ${report.coverage.elements} elements.`,
  );
  if (report.coverage.complete === false)
    lines.push(
      report.coverage.acceptedIncomplete
        ? "PARTIAL: truncated collection was explicitly accepted; uncollected elements remain unchecked."
        : "INCOMPLETE: collection was truncated. Increase maxElements or explicitly set coveragePolicy to allow-truncated.",
    );
  for (const limit of report.coverage.limitations)
    lines.push(`  Limit: ${limit}`);
  return lines.join("\n");
}
