import { currencyDigits, getCountry } from "../countries";
import { calculateOrder } from "./engine";
import { createInvoiceDraft } from "./invoice";
import {
  array,
  choice,
  keys,
  money,
  obj,
  text,
  validateComplianceConfig,
} from "./validation";
import type { ComplianceConfig, InvoiceDetails, Order } from "./types";

export interface FinancialCase {
  name: string;
  order: Order;
  details?: InvoiceDetails;
  expected: {
    status: "ready" | "needs-context" | "unsupported" | "invalid";
    net?: string;
    tax?: string;
    gross?: string;
    issueCodes?: string[];
  };
}
export interface FinancialCheckOptions {
  /** The accepted workflow must contain at least one successful case of each selected kind. */
  scope?: "quotes" | "invoices" | "both";
}

/** Exact financial acceptance: status-only ready cases never qualify as complete coverage. */
export function checkFinancialCases(
  config: ComplianceConfig,
  input: unknown,
  options: FinancialCheckOptions = {},
) {
  validateComplianceConfig(config);
  const scope = options.scope ?? "invoices";
  choice(scope, ["quotes", "invoices", "both"], "financial check scope");
  array(input, "Financial cases", 1, 1000);
  const digits = currencyDigits(getCountry(config.business.country).currency);
  const names = new Set<string>();
  const gaps: string[] = [];
  const quotes = { total: 0, ready: 0, exactAssertions: 0 };
  const invoices = { total: 0, ready: 0, exactAssertions: 0 };
  let negativeCases = 0;
  const cases = input.map((entry, index) => {
    obj(entry);
    keys(entry, ["name", "order", "details", "expected"]);
    text(entry.name, "Case name");
    if (names.has(entry.name))
      throw Error("Financial case names must be unique.");
    names.add(entry.name);
    obj(entry.expected);
    keys(entry.expected, ["status", "net", "tax", "gross", "issueCodes"]);
    choice(
      entry.expected.status,
      ["ready", "needs-context", "unsupported", "invalid"],
      "expected status",
    );
    const expected = entry.expected;
    const amountFields = ["net", "tax", "gross"] as const;
    if (expected.status === "ready") {
      if (expected.issueCodes !== undefined)
        throw Error("Ready cases cannot expect issue codes.");
      for (const field of amountFields)
        if (expected[field] !== undefined)
          money(expected[field], digits, `Expected ${field}`);
    } else {
      negativeCases++;
      if (expected.issueCodes === undefined)
        gaps.push(
          `Case ${index + 1} (${entry.name}) needs expected issueCodes to verify why it was rejected.`,
        );
      if (amountFields.some((field) => field in expected))
        throw Error("Incomplete cases cannot expect calculated totals.");
    }
    if (expected.issueCodes !== undefined) {
      array(expected.issueCodes, "Expected issueCodes", 1);
      expected.issueCodes.forEach((code) => text(code, "Expected issue code"));
      if (new Set(expected.issueCodes).size !== expected.issueCodes.length)
        throw Error("Expected issueCodes must be unique.");
    }
    const entryCase = entry as unknown as FinancialCase;
    const kind =
      entry.details === undefined ? ("quote" as const) : ("invoice" as const);
    const coverage = kind === "quote" ? quotes : invoices;
    coverage.total++;
    const result =
      kind === "invoice"
        ? createInvoiceDraft(config, entryCase.order, entryCase.details!)
        : calculateOrder(config, entryCase.order);
    let passed = result.status === expected.status;
    const exact =
      expected.status === "ready" &&
      amountFields.every((field) => typeof expected[field] === "string");
    if (expected.status === "ready" && !exact) {
      gaps.push(
        `Case ${index + 1} (${entry.name}) needs independently reviewed expected net, tax and gross amounts.`,
      );
      passed = false;
    }
    if (result.status === "ready") {
      coverage.ready++;
      if (exact) coverage.exactAssertions++;
      const totals =
        "calculation" in result.value ? result.value.calculation : result.value;
      for (const field of amountFields)
        if (expected[field] !== undefined && totals[field] !== expected[field])
          passed = false;
      return {
        name: entry.name,
        kind,
        passed,
        status: result.status,
        exactAssertions: exact,
        actual: { net: totals.net, tax: totals.tax, gross: totals.gross },
        expected: { ...expected },
        digest: result.value.digest,
      };
    }
    if (
      expected.issueCodes?.some(
        (code) => !result.issues.some((issue) => issue.code === code),
      )
    )
      passed = false;
    return {
      name: entry.name,
      kind,
      passed,
      status: result.status,
      exactAssertions: false,
      expected: { ...expected },
      issues: result.issues,
    };
  });
  for (const [kind, coverage] of [
    ["quotes", quotes],
    ["invoices", invoices],
  ] as const) {
    if ((scope === kind || scope === "both") && !coverage.exactAssertions)
      gaps.push(
        `The ${scope} acceptance scope requires at least one ready ${kind === "quotes" ? "quote" : "invoice"} case with exact expected amounts.`,
      );
  }
  const incomplete =
    gaps.length > 0 ||
    cases.some(
      (entry) =>
        !entry.passed &&
        ["needs-context", "unsupported"].includes(entry.status),
    );
  const exitCode = incomplete
    ? (2 as const)
    : cases.some((entry) => !entry.passed)
      ? (1 as const)
      : (0 as const);
  return {
    cases,
    coverage: {
      scope,
      quotes,
      invoices,
      negativeCases,
      complete: !incomplete,
      gaps,
    },
    exitCode,
  };
}
