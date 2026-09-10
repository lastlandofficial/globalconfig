import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { dateOnly, freeze } from "../internal";
import { array, unique, validateTreatment } from "./validation";
import type {
  ComplianceIssue,
  Requirement,
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
const inSource =
  "https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001";
const jpSource =
  "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm";
const base = {
  reviewedOn: "2026-09-09",
  reviewAfter: "2026-12-09",
  scope:
    "Selected ordinary domestic invoice checks; applicability and exceptions require a recorded business review.",
};
export const requirements: readonly Requirement[] = freeze([
  ...[
    [
      "IN-GST-INVOICE-PARTIES",
      "Supplier and recipient particulars",
      "Rule 46(a), (d), (e)",
    ],
    ["IN-GST-INVOICE-NUMBER", "Invoice number and date", "Rule 46(b), (c)"],
    [
      "IN-GST-INVOICE-ITEMS",
      "Classification, quantity, unit and description",
      "Rule 46(f)–(h)",
    ],
    [
      "IN-GST-INVOICE-TOTALS",
      "Taxable value, rates and tax amounts",
      "Rule 46(i)–(m)",
    ],
    [
      "IN-GST-INVOICE-PLACE-OF-SUPPLY",
      "Place of supply and delivery address",
      "Rule 46(n), (o)",
    ],
    [
      "IN-GST-INVOICE-AUTHORIZATION",
      "Signature, reverse charge and e-invoice review",
      "Rule 46(p)–(s), Rule 48",
    ],
  ].map(([id, title, provision]) => ({
    ...base,
    id: id!,
    title: title!,
    provision: provision!,
    country: "IN" as const,
    source: inSource,
  })),
  {
    ...base,
    id: "JP-INVOICE-PARTICULARS",
    title: "Qualified invoice particulars",
    provision: "Consumption Tax Act 57-4; NTA No. 6625",
    country: "JP",
    source: jpSource,
  },
  {
    ...base,
    id: "JP-INVOICE-ROUNDING",
    title: "Round once per invoice tax rate",
    provision: "NTA No. 6371",
    country: "JP",
    source: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm",
  },
  {
    ...base,
    id: "US-CA-RATE-DECISION",
    title: "Reviewed combined jurisdiction rate",
    provision: "CDTFA Know Your Rate",
    country: "US",
    source: "https://cdtfa.ca.gov/taxes-and-fees/know-your-rate.htm",
    scope:
      "California reference only. No ZIP-only rate lookup, nexus decision, or other-state legal profile.",
  },
]);
export function createReviewedTaxProvider(
  rules: readonly TreatmentRule[],
): TaxProvider {
  array(rules, "Treatments");
  rules.forEach(validateTreatment);
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
  engine: "glocon-order-1";
  ruleRevision: string;
  rulesDigest: string;
  configDigest: string;
}
export const createComplianceLock = (
  config: unknown & { rules: RulePack },
): ComplianceLock => ({
  version: 1,
  engine: "glocon-order-1",
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
