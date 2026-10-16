import { rules } from "./rules";
import { createReport, fingerprint, validateAuditOptions } from "./report";
import type {
  AuditOptions,
  AuditReport,
  Finding,
  Rule,
  RuleOutcome,
  UISnapshot,
} from "./types";
export { rules } from "./rules";

export function auditSnapshot(
  snapshot: UISnapshot,
  options: AuditOptions = {},
  customRules: Rule[] = [],
): AuditReport {
  validateAuditOptions(options);
  const allRules = [...rules, ...customRules];
  for (const rule of allRules) {
    if (!rule?.meta || typeof rule.check !== "function")
      throw new Error("Rules require metadata and a check function.");
    for (const key of ["id", "title", "rationale"] as const)
      if (typeof rule.meta[key] !== "string" || !rule.meta[key].trim())
        throw new Error(`Rule metadata requires a non-empty ${key}.`);
    if (!["error", "warning", "info"].includes(rule.meta.severity))
      throw new Error(`Invalid rule severity for ${rule.meta.id}`);
    if (!["high", "medium"].includes(rule.meta.confidence))
      throw new Error(`Invalid rule confidence for ${rule.meta.id}`);
    if (
      !["accessibility", "layout", "consistency", "ux"].includes(
        rule.meta.category,
      )
    )
      throw new Error(`Invalid rule category for ${rule.meta.id}`);
    if (
      rule.meta.helpUrl !== undefined &&
      typeof rule.meta.helpUrl !== "string"
    )
      throw new Error(`Invalid rule helpUrl for ${rule.meta.id}`);
  }
  const ids = allRules.map((r) => r.meta.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Rule IDs must be unique.");
  for (const id of Object.keys(options.rules ?? {})) {
    if (
      !ids.includes(id) &&
      !id.startsWith("axe/") &&
      !id.startsWith("contract/")
    )
      throw new Error(`Unknown rule: ${id}`);
  }
  const findings: Finding[] = [];
  const executed: string[] = [];
  const outcomes: RuleOutcome[] = [];
  const elementsByTarget = new Map<string, UISnapshot["elements"][number]>();
  for (const element of snapshot.elements)
    if (!elementsByTarget.has(element.target))
      elementsByTarget.set(element.target, element);
  const targets = [...elementsByTarget.keys()];
  if (snapshot.platform === "web" && !elementsByTarget.has("html"))
    targets.push("html");
  for (const rule of allRules) {
    const id = rule.meta.id;
    if (
      options.rules?.[id] === "off" ||
      (snapshot.platform === "web" && id.startsWith("native/"))
    )
      continue;
    if (id === "consistency/spacing" && !options.spacingScale?.length) continue;
    executed.push(id);
    const results = rule.check(snapshot, options);
    if (!results.length) {
      outcomes.push({ ruleId: id, status: "passed" });
      if (id === "layout/overflow" && snapshot.platform === "web")
        outcomes.push({ ruleId: id, target: "html", status: "passed" });
    }
    for (const result of results) {
      outcomes.push({
        ruleId: id,
        target: result.target,
        status: "failed",
      });
      const element = elementsByTarget.get(result.target);
      if (element?.ignore.includes(id)) continue;
      findings.push({
        ...result,
        fingerprint: fingerprint(id, result.target),
        ruleId: id,
        severity: rule.meta.severity,
        confidence: rule.meta.confidence,
        category: rule.meta.category,
        ...(rule.meta.helpUrl ? { helpUrl: rule.meta.helpUrl } : {}),
      });
    }
  }
  return createReport(
    snapshot.url ?? snapshot.platform,
    findings,
    {
      rules: executed,
      outcomes,
      targets,
      elements: snapshot.elements.length,
      ...(snapshot.collection ? { collection: snapshot.collection } : {}),
      limitations: [
        ...(snapshot.limitations ?? []),
        "Checks cover only the supplied state and viewport. A clean report is not a usability or accessibility certification.",
        "Visual taste, task success, reading order, and interaction flows require human review or explicit scenario tests.",
      ],
    },
    options,
  );
}
