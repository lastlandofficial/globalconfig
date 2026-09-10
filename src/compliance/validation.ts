import { dateOnly, decimal, rounding } from "../internal";
import { currencyDigits, getCountry } from "../countries";
import type { ComplianceConfig, Order, Review, TreatmentRule } from "./types";
export function obj(v: unknown): asserts v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Expected an object.");
}
export function keys(v: object, allowed: string[]) {
  for (const key of Object.keys(v))
    if (!allowed.includes(key)) throw Error(`Unknown field: ${key}`);
}
export function text(v: unknown, label: string): asserts v is string {
  if (typeof v !== "string" || !v.trim() || v.length > 10000)
    throw Error(`${label} must be a non-empty string (max 10000 characters).`);
}
export function choice(v: unknown, values: readonly string[], label: string) {
  if (typeof v !== "string" || !values.includes(v))
    throw Error(`Invalid ${label}. Expected ${values.join(", ")}.`);
}
export function array(
  v: unknown,
  label: string,
  min = 0,
  max = 1000,
): asserts v is unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max)
    throw Error(`${label} must contain ${min}–${max} entries.`);
}
export function unique(items: { id: string }[]) {
  if (new Set(items.map((x) => x.id)).size !== items.length)
    throw Error("IDs must be unique.");
}
export function money(value: unknown, digits: number, label: string) {
  if (typeof value !== "string")
    throw Error(`${label} must be a decimal string.`);
  const n = decimal(value, label);
  if (n.isNegative() || n.decimalPlaces() > digits)
    throw Error(`${label} must be nonnegative whole currency minor units.`);
  return n;
}
export function review(value: unknown): asserts value is Review {
  obj(value);
  keys(value, ["by", "on", "after", "reference"]);
  text(value.by, "Reviewer");
  text(value.reference, "Review reference");
  dateOnly(value.on as string);
  dateOnly(value.after as string);
  if (String(value.after) <= String(value.on))
    throw Error("Review deadline must follow review date.");
}
export function validateComplianceConfig(input: unknown): ComplianceConfig {
  obj(input);
  keys(input, [
    "$schema",
    "version",
    "business",
    "products",
    "rules",
    "rounding",
  ]);
  if (input.version !== 1)
    throw Error("Compliance configuration version must be 1.");
  if (input.$schema !== undefined) text(input.$schema, "$schema");
  obj(input.business);
  const b = input.business;
  keys(b, [
    "id",
    "name",
    "address",
    "country",
    "environment",
    "registration",
    "registrationId",
    "stateCode",
    "review",
    "invoiceSeries",
    "india",
  ]);
  for (const k of ["id", "name", "address", "invoiceSeries"])
    text(b[k], `Business ${k}`);
  choice(b.country, ["IN", "JP", "US"], "country");
  choice(b.environment, ["test", "production"], "environment");
  choice(
    b.registration,
    ["registered", "unregistered", "unknown"],
    "registration",
  );
  if (!/^[A-Z0-9]{1,3}$/.test(String(b.invoiceSeries)))
    throw Error("invoiceSeries must be 1–3 uppercase letters or digits.");
  for (const k of ["registrationId", "stateCode"])
    if (b[k] !== undefined) text(b[k], k);
  if (b.review !== undefined) review(b.review);
  if (b.india !== undefined) {
    obj(b.india);
    keys(b.india, ["eInvoice", "declaration", "signature"]);
    choice(
      b.india.eInvoice,
      ["required", "not-required", "unknown"],
      "eInvoice",
    );
    choice(
      b.india.signature,
      ["required", "electronic-exception", "unknown"],
      "signature",
    );
    if (b.india.declaration !== undefined)
      text(b.india.declaration, "declaration");
  }
  if (b.country !== "IN" && b.india !== undefined)
    throw Error("india settings require an India business.");
  rounding(input.rounding as never);
  if (input.rounding === undefined)
    throw Error("Choose an explicit rounding mode.");
  const digits = currencyDigits(getCountry(String(b.country)).currency);
  array(input.products, "Products", 1);
  for (const p of input.products) {
    obj(p);
    keys(p, ["id", "description", "unitPrice", "classification", "unit"]);
    text(p.id, "Product ID");
    text(p.description, "Description");
    money(p.unitPrice, digits, "unitPrice");
    for (const k of ["classification", "unit"])
      if (p[k] !== undefined) text(p[k], k);
  }
  unique(input.products as { id: string }[]);
  obj(input.rules);
  keys(input.rules, ["version", "revision", "requirements", "treatments"]);
  if (input.rules.version !== 1) throw Error("Rule pack version must be 1.");
  text(input.rules.revision, "Rule revision");
  array(input.rules.requirements, "Requirements", 1);
  array(input.rules.treatments, "Treatments");
  for (const r of input.rules.requirements) {
    obj(r);
    keys(r, [
      "id",
      "title",
      "country",
      "source",
      "provision",
      "reviewedOn",
      "reviewAfter",
      "scope",
    ]);
    for (const k of ["id", "title", "source", "provision", "scope"])
      text(r[k], k);
    choice(r.country, ["IN", "JP", "US"], "requirement country");
    if (new URL(String(r.source)).protocol !== "https:")
      throw Error("Requirement sources must use HTTPS.");
    dateOnly(r.reviewedOn as string);
    dateOnly(r.reviewAfter as string);
    if (String(r.reviewAfter) <= String(r.reviewedOn))
      throw Error("Requirement reviewAfter must follow reviewedOn.");
  }
  unique(input.rules.requirements as { id: string }[]);
  for (const r of input.rules.treatments) {
    validateTreatment(r);
    if (!(input.products as { id: string }[]).some((p) => p.id === r.productId))
      throw Error("Treatment references an unknown product.");
  }
  unique(input.rules.treatments as { id: string }[]);
  return input as unknown as ComplianceConfig;
}
export const defineComplianceConfig = validateComplianceConfig;
export function validateOrder(input: unknown, digits: number): Order {
  obj(input);
  keys(input, [
    "id",
    "date",
    "jurisdiction",
    "buyer",
    "scenario",
    "lines",
    "discount",
    "pricing",
    "supply",
    "localTax",
    "placeOfSupply",
  ]);
  text(input.id, "Order ID");
  dateOnly(input.date as string);
  text(input.jurisdiction, "Jurisdiction");
  choice(
    input.scenario,
    [
      "ordinary-domestic",
      "cross-border",
      "reverse-charge",
      "marketplace",
      "special",
    ],
    "scenario",
  );
  choice(input.pricing, ["inclusive", "exclusive"], "pricing");
  obj(input.buyer);
  keys(input.buyer, [
    "name",
    "country",
    "address",
    "registrationId",
    "stateCode",
  ]);
  text(input.buyer.name, "Buyer name");
  choice(input.buyer.country, ["IN", "JP", "US"], "buyer country");
  for (const k of ["address", "registrationId", "stateCode"])
    if (input.buyer[k] !== undefined) text(input.buyer[k], k);
  array(input.lines, "Order lines", 1);
  for (const line of input.lines) {
    obj(line);
    keys(line, ["id", "productId", "quantity", "discount"]);
    text(line.id, "Line ID");
    text(line.productId, "Product ID");
    if (
      !Number.isSafeInteger(line.quantity) ||
      Number(line.quantity) < 1 ||
      Number(line.quantity) > 1000000
    )
      throw Error("Quantity must be an integer from 1 to 1000000.");
    if (line.discount !== undefined)
      money(line.discount, digits, "Line discount");
  }
  unique(input.lines as { id: string }[]);
  if (input.discount !== undefined)
    money(input.discount, digits, "Order discount");
  if (input.supply !== undefined)
    choice(input.supply, ["intra-state", "inter-state"], "supply");
  if (input.localTax !== undefined)
    choice(input.localTax, ["SGST", "UTGST"], "localTax");
  if (input.placeOfSupply !== undefined)
    text(input.placeOfSupply, "placeOfSupply");
  return input as unknown as Order;
}

export function validateTreatment(r: unknown): asserts r is TreatmentRule {
  obj(r);
  keys(r, [
    "id",
    "productId",
    "jurisdiction",
    "treatment",
    "rate",
    "effectiveFrom",
    "effectiveTo",
    "review",
    "reason",
  ]);
  for (const k of ["id", "productId", "jurisdiction"]) text(r[k], k);
  choice(
    r.treatment,
    ["taxable", "zero-rated", "exempt", "out-of-scope"],
    "treatment",
  );
  if (typeof r.rate !== "string") throw Error("Rate must be a decimal string.");
  const rate = decimal(r.rate);
  if (rate.lt(0) || rate.gt(100)) throw Error("Rate must be 0–100 percent.");
  if ((r.treatment === "taxable") !== rate.gt(0))
    throw Error(
      "Taxable treatments require a positive rate; other treatments require zero.",
    );
  if (r.treatment !== "taxable" || r.reason !== undefined)
    text(r.reason, "Treatment reason");
  dateOnly(r.effectiveFrom as string);
  if (r.effectiveTo !== undefined) {
    dateOnly(r.effectiveTo as string);
    if (String(r.effectiveTo) <= String(r.effectiveFrom))
      throw Error("effectiveTo must follow effectiveFrom.");
  }
  review(r.review);
}
