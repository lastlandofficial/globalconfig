import { calculationEngine } from "./billing";
import { ORDER_PROFILE_1 } from "./profiles";
import { validateTreatment as validateLegacyTreatment } from "./legacy-validation";
import type { BillingPolicy } from "./types";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { dateOnly, freeze } from "../internal";
import { array, unique, validateTreatment } from "./validation";
import type {
  ComplianceIssue,
  RulePack,
  TaxProvider,
  TreatmentRule,
} from "./types";
export function canonical(value: unknown): string {
  const seen = new Set<object>();
  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (
      !v ||
      typeof v !== "object" ||
      seen.has(v) ||
      (!Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null)
    )
      throw Error("Expected acyclic JSON data.");
    seen.add(v);
    const out = Array.isArray(v)
      ? v.map(normalize)
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
        );
    seen.delete(v);
    return out;
  };
  return JSON.stringify(normalize(value));
}
export const digest = (value: unknown) =>
  bytesToHex(sha256(utf8ToBytes(canonical(value))));
export const copy = <T>(value: T): T => JSON.parse(canonical(value)) as T;
export function issue(
  code: string,
  field: string,
  message: string,
  fix: string,
  source?: string,
): ComplianceIssue {
  return { code, field, message, fix, ...(source ? { source } : {}) };
}
// The current exported requirements can move to a newer profile in a future release.
// Historical calculation replay imports its pinned profile directly.
export const requirements = ORDER_PROFILE_1.requirements;
export function createReviewedTaxProvider(
  rules: readonly TreatmentRule[],
): TaxProvider {
  return reviewedTaxProvider(rules, false, validateTreatment);
}
/** Original review semantics are retained only for registered historical-engine replay. */
export function createHistoricalTaxProvider(
  rules: readonly TreatmentRule[],
): TaxProvider {
  return reviewedTaxProvider(rules, true, validateLegacyTreatment);
}
function reviewedTaxProvider(
  rules: readonly TreatmentRule[],
  historical: boolean,
  validateRule: typeof validateTreatment,
): TaxProvider {
  array(rules, "Treatments");
  rules.forEach(validateRule);
  unique(rules as TreatmentRule[]);
  const saved = copy(rules);
  return Object.freeze({
    id: "reviewed-local-rules",
    resolve(productId: string, jurisdiction: string, on: string) {
      dateOnly(on);
      const candidates = saved.filter(
        (r) =>
          r.productId === productId &&
          r.jurisdiction === jurisdiction &&
          r.effectiveFrom <= on &&
          (!r.effectiveTo || r.effectiveTo > on),
      );
      if (candidates.length !== 1)
        return {
          status: "needs-context" as const,
          issues: [
            issue(
              "TAX-TREATMENT",
              `products.${productId}`,
              candidates.length
                ? "Multiple treatments match this transaction."
                : "No reviewed treatment matches this transaction.",
              "Provide one dated treatment for this product and exact jurisdiction.",
            ),
          ],
        };
      const rule = candidates[0]!;
      if (!historical && on < (rule.review.appliesFrom ?? rule.review.on))
        return {
          status: "needs-context" as const,
          issues: [
            issue(
              "TAX-REVIEW-NOT-APPLICABLE",
              `rules.${rule.id}`,
              "The treatment review does not cover this transaction date.",
              "Record an explicit review applicability start when approving historical transactions.",
            ),
          ],
        };
      if (on >= rule.review.after)
        return {
          status: "needs-context" as const,
          issues: [
            issue(
              "TAX-REVIEW-EXPIRED",
              `rules.${rule.id}`,
              "Treatment review has expired.",
              "Review and renew the treatment with a source reference.",
            ),
          ],
        };
      return { status: "ready" as const, value: freeze(copy(rule)) };
    },
  });
}
export interface ComplianceLock {
  version: 1;
  engine: "glocon-order-1" | "glocon-order-2" | "glocon-order-3";
  ruleRevision: string;
  rulesDigest: string;
  configDigest: string;
}
export const createComplianceLock = (
  config: unknown & { rules: RulePack; billing?: BillingPolicy },
): ComplianceLock => ({
  version: 1,
  engine: calculationEngine(config),
  ruleRevision: config.rules.revision,
  rulesDigest: digest(config.rules),
  configDigest: digest(config),
});
export function compareRulePacks(before: RulePack, after: RulePack) {
  const changes: {
    kind: "added" | "removed" | "changed";
    section: string;
    id: string;
  }[] = [];
  for (const section of ["requirements", "treatments"] as const) {
    const a = new Map(before[section].map((x) => [x.id, x]));
    const b = new Map(after[section].map((x) => [x.id, x]));
    for (const [id, value] of a)
      if (!b.has(id)) changes.push({ kind: "removed", section, id });
      else if (digest(value) !== digest(b.get(id)))
        changes.push({ kind: "changed", section, id });
    for (const id of b.keys())
      if (!a.has(id)) changes.push({ kind: "added", section, id });
  }
  return { before: before.revision, after: after.revision, changes };
}
