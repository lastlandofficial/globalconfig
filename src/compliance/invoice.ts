import { D, dateOnly, freeze } from "../internal";
import { currencyDigits } from "../countries";
import { calculateOrder, verifyCalculation } from "./engine";
import { copy, digest, issue, requirements } from "./rules";
import { array, keys, obj, review, text, unique } from "./validation";
import type {
  Calculation,
  ComplianceConfig,
  ComplianceIssue,
  CreditNoteDraft,
  CreditRequest,
  InvoiceDetails,
  InvoiceDraft,
  Order,
  Result,
} from "./types";
export function validateInvoice(invoice: InvoiceDraft): {
  valid: boolean;
  issues: ComplianceIssue[];
} {
  const issues: ComplianceIssue[] = [];
  try {
    obj(invoice);
    keys(invoice, [
      "kind",
      "version",
      "status",
      "details",
      "calculation",
      "digest",
    ]);
    if (
      invoice.kind !== "invoice" ||
      invoice.version !== 1 ||
      invoice.status !== "draft"
    )
      throw Error("Expected a version 1 invoice draft.");
    if (!verifyCalculation(invoice.calculation))
      throw Error("Calculation snapshot does not replay exactly.");
    const { calculation: c, details: d } = invoice;
    obj(d);
    keys(d, [
      "number",
      "issuedOn",
      "signatureEvidence",
      "externalRegistration",
    ]);
    text(d.number, "Invoice number");
    dateOnly(d.issuedOn);
    if (d.issuedOn < c.snapshot.order.date)
      throw Error("Issue date precedes transaction date.");
    const b = c.snapshot.config.business,
      o = c.snapshot.order;
    const check = (
      ok: unknown,
      code: string,
      field: string,
      message: string,
      fix: string,
    ) => {
      if (!ok)
        issues.push(
          issue(
            code,
            field,
            message,
            fix,
            requirements.find((r) => r.id === code)?.source,
          ),
        );
    };
    // Issue-date review freshness is separate from transaction-date tax selection.
    if (
      d.issuedOn >= (b.review?.after ?? "") ||
      c.snapshot.config.rules.requirements.some(
        (r) => r.country === b.country && d.issuedOn >= r.reviewAfter,
      )
    )
      issues.push(
        issue(
          "ISSUE-REVIEW",
          "details.issuedOn",
          "Review evidence is stale for issuance.",
          "Renew reviews and recalculate before creating an invoice.",
        ),
      );
    if (b.country === "IN") {
      check(
        /^[A-Za-z0-9\-/]{1,16}$/.test(d.number),
        "IN-GST-INVOICE-NUMBER",
        "details.number",
        "Invoice number must contain 1–16 letters, digits, / or -.",
        "Use an atomically allocated, financial-year-unique number.",
      );
      check(
        !!b.registrationId && /^[0-9]{2}[A-Z0-9]{13}$/.test(b.registrationId),
        "IN-GST-INVOICE-PARTIES",
        "business.registrationId",
        "Supplier GSTIN is missing or malformed.",
        "Provide the reviewed supplier GSTIN; syntax checks do not verify registration.",
      );
      check(
        o.buyer.address,
        "IN-GST-INVOICE-PARTIES",
        "buyer.address",
        "Buyer address is missing.",
        "Provide recipient and delivery details for the selected ordinary invoice.",
      );
      check(
        o.buyer.stateCode && /^\d{2}$/.test(o.buyer.stateCode),
        "IN-GST-INVOICE-PARTIES",
        "buyer.stateCode",
        "Recipient state code is missing.",
        "Provide the reviewed recipient state code.",
      );
      if (o.buyer.registrationId)
        check(
          /^[0-9]{2}[A-Z0-9]{13}$/.test(o.buyer.registrationId),
          "IN-GST-INVOICE-PARTIES",
          "buyer.registrationId",
          "Recipient GSTIN is malformed.",
          "Provide the reviewed GSTIN.",
        );
      check(
        c.lines.every((l) => /^\d{4,8}$/.test(l.classification) && !!l.unit),
        "IN-GST-INVOICE-ITEMS",
        "lines",
        "Classification or unit is missing.",
        "Provide the reviewed HSN/SAC code and unit; applicability of code length must be reviewed.",
      );
      if (o.supply === "inter-state")
        check(
          o.placeOfSupply,
          "IN-GST-INVOICE-PLACE-OF-SUPPLY",
          "transaction.placeOfSupply",
          "Inter-state place of supply is missing.",
          "Provide the reviewed place-of-supply state name and code.",
        );
      check(
        b.india &&
          b.india.eInvoice !== "unknown" &&
          b.india.signature !== "unknown",
        "IN-GST-INVOICE-AUTHORIZATION",
        "business.india",
        "Invoice authorization requirements are unresolved.",
        "Review signature, declaration, and IRP applicability.",
      );
      if (b.india?.signature === "required")
        check(
          d.signatureEvidence,
          "IN-GST-INVOICE-AUTHORIZATION",
          "details.signatureEvidence",
          "Required signature evidence is missing.",
          "Supply evidence of the signed invoice before issuance.",
        );
      if (b.india?.eInvoice === "required") {
        const r = d.externalRegistration;
        check(
          r &&
            /^[a-fA-F0-9]{64}$/.test(r.irn) &&
            r.signedQR &&
            r.evidence &&
            r.verifiedBy &&
            r.verifiedOn,
          "IN-GST-INVOICE-AUTHORIZATION",
          "details.externalRegistration",
          "Required verified IRP registration evidence is missing.",
          "Supply the verified IRN, signed QR payload and verification record.",
        );
      }
    } else if (b.country === "JP") {
      check(
        b.registrationId && /^T\d{13}$/.test(b.registrationId),
        "JP-INVOICE-PARTICULARS",
        "business.registrationId",
        "Qualified issuer registration number is missing or malformed.",
        "Provide the reviewed T + 13-digit issuer number; registry validity requires separate verification.",
      );
    }
    if (b.country !== "US" && c.lines.some((l) => l.treatment !== "taxable"))
      issues.push(
        issue(
          "DOCUMENT-TYPE-UNSUPPORTED",
          "lines",
          "The selected India/Japan invoice profile covers ordinary taxable invoices only.",
          "Use a reviewed bill-of-supply, exempt or other document implementation.",
        ),
      );
    if (d.signatureEvidence !== undefined)
      text(d.signatureEvidence, "Signature evidence");
    if (d.externalRegistration !== undefined) {
      obj(d.externalRegistration);
      keys(d.externalRegistration, [
        "irn",
        "signedQR",
        "evidence",
        "verifiedBy",
        "verifiedOn",
      ]);
      for (const k of ["irn", "signedQR", "evidence", "verifiedBy"])
        text(
          d.externalRegistration[k as keyof typeof d.externalRegistration],
          k,
        );
      dateOnly(d.externalRegistration.verifiedOn);
      if (d.externalRegistration.verifiedOn < d.issuedOn)
        throw Error("Registration verification predates invoice issue date.");
    }
    const { digest: _, ...body } = invoice;
    if (digest(body) !== invoice.digest)
      throw Error("Invoice digest does not match its contents.");
  } catch (e) {
    issues.push(
      issue(
        "INVALID-INVOICE",
        "invoice",
        e instanceof Error ? e.message : String(e),
        "Recreate the draft from trusted configuration and order data.",
      ),
    );
  }
  return { valid: issues.length === 0, issues };
}
export function createInvoiceDraft(
  config: ComplianceConfig,
  order: Order,
  details: InvoiceDetails,
): Result<InvoiceDraft> {
  const calculated = calculateOrder(config, order);
  if (calculated.status !== "ready") return calculated;
  try {
    const body = {
      kind: "invoice" as const,
      version: 1 as const,
      status: "draft" as const,
      details: copy(details),
      calculation: calculated.value,
    };
    const invoice = freeze({ ...body, digest: digest(body) });
    const validation = validateInvoice(invoice);
    if (!validation.valid)
      return {
        status: validation.issues.some((i) => i.code === "INVALID-INVOICE")
          ? "invalid"
          : validation.issues.some(
                (i) => i.code === "DOCUMENT-TYPE-UNSUPPORTED",
              )
            ? "unsupported"
            : "needs-context",
        issues: validation.issues,
      };
    return { status: "ready", value: invoice };
  } catch (e) {
    return {
      status: "invalid",
      issues: [
        issue(
          "INVALID-INVOICE",
          "details",
          String(e),
          "Correct invoice details.",
        ),
      ],
    };
  }
}
/** Pure financial credit allocation. Persist original + all prior credits atomically at issuance. */
export function createCreditNoteDraft(
  original: InvoiceDraft,
  request: CreditRequest,
  previous: readonly CreditNoteDraft[] = [],
): Result<CreditNoteDraft> {
  try {
    if (!validateInvoice(original).valid)
      throw Error("Original invoice is invalid.");
    obj(request);
    keys(request, ["number", "date", "reason", "review", "lines"]);
    text(request.number, "Credit number");
    text(request.reason, "Credit reason");
    dateOnly(request.date);
    review(request.review);
    if (
      request.date < original.details.issuedOn ||
      request.date >= request.review.after
    )
      throw Error("Credit date precedes invoice or credit review has expired.");
    array(request.lines, "Credit lines", 1);
    const ids = new Set<string>();
    for (const l of request.lines) {
      obj(l);
      keys(l, ["lineId", "quantity"]);
      text(l.lineId, "Line ID");
      if (
        ids.has(l.lineId) ||
        !Number.isSafeInteger(l.quantity) ||
        l.quantity < 1
      )
        throw Error(
          "Credit lines require unique IDs and positive integer quantities.",
        );
      ids.add(l.lineId);
    }
    const c = original.calculation,
      digits = currencyDigits(c.currency),
      scale = new D(10).pow(digits);
    const minor = (v: string) => BigInt(new D(v).mul(scale).toFixed(0));
    const amount = (v: bigint) =>
      new D(v.toString()).div(scale).toFixed(digits);
    const used = new Map<
      string,
      { quantity: number; net: bigint; tax: bigint }
    >();
    const priorIds = new Set<string>();
    for (const [index, credit] of previous.entries()) {
      if (
        credit.originalDigest !== original.digest ||
        priorIds.has(credit.digest) ||
        credit.request.date > request.date ||
        credit.request.number === request.number
      )
        throw Error(
          "Credit history has a wrong original, duplicate, future credit or reused number.",
        );
      // Validate the chain using the same deterministic allocation, not caller-supplied totals.
      const expected = creditBody(
        original,
        credit.request,
        previous.slice(0, index),
        used,
        minor,
        amount,
      );
      if (digest({ ...expected, digest: digest(expected) }) !== digest(credit))
        throw Error("Credit history does not replay.");
      priorIds.add(credit.digest);
      for (const line of credit.lines) {
        const u = used.get(line.lineId) ?? { quantity: 0, net: 0n, tax: 0n };
        used.set(line.lineId, {
          quantity: u.quantity + line.quantity,
          net: u.net + minor(line.net),
          tax: u.tax + minor(line.tax),
        });
      }
    }
    for (const line of request.lines)
      if (!c.lines.some((l) => l.id === line.lineId))
        throw Error("Unknown invoice line.");
    const body = creditBody(
      original,
      copy(request),
      previous,
      used,
      minor,
      amount,
    );
    return {
      status: "ready",
      value: freeze({ ...body, digest: digest(body) }),
    };
  } catch (e) {
    return {
      status: "invalid",
      issues: [
        issue(
          "INVALID-CREDIT",
          "credit",
          e instanceof Error ? e.message : String(e),
          "Use the original invoice, a complete ordered credit history and reviewed eligible quantities.",
        ),
      ],
    };
  }
}
function creditBody(
  original: InvoiceDraft,
  request: CreditRequest,
  previous: readonly CreditNoteDraft[],
  used: Map<string, { quantity: number; net: bigint; tax: bigint }>,
  minor: (v: string) => bigint,
  amount: (v: bigint) => string,
) {
  review(request.review);
  dateOnly(request.date);
  text(request.number, "Credit number");
  text(request.reason, "Credit reason");
  if (
    request.date < original.details.issuedOn ||
    request.date >= request.review.after
  )
    throw Error("Invalid credit date/review.");
  array(request.lines, "Credit lines", 1);
  unique(request.lines.map((l) => ({ id: l.lineId })));
  const lines = request.lines.map((l) => {
    const source = original.calculation.lines.find((s) => s.id === l.lineId);
    const u = used.get(l.lineId) ?? { quantity: 0, net: 0n, tax: 0n };
    if (
      !source ||
      !Number.isSafeInteger(l.quantity) ||
      l.quantity < 1 ||
      l.quantity + u.quantity > source.quantity
    )
      throw Error("Credit exceeds remaining invoice quantity.");
    const numerator = BigInt(l.quantity + u.quantity),
      denominator = BigInt(source.quantity);
    const net = (minor(source.net) * numerator) / denominator - u.net,
      tax = (minor(source.tax) * numerator) / denominator - u.tax;
    if (net < 0n || tax < 0n)
      throw Error("Credit history exceeds original amounts.");
    return {
      lineId: l.lineId,
      quantity: l.quantity,
      net: amount(net),
      tax: amount(tax),
      gross: amount(net + tax),
      rate: source.rate,
    };
  });
  return {
    kind: "credit-note" as const,
    version: 1 as const,
    status: "draft" as const,
    originalDigest: original.digest,
    originalNumber: original.details.number,
    originalDate: original.details.issuedOn,
    request,
    previousDigests: previous.map((c) => c.digest),
    lines,
    net: amount(lines.reduce((n, l) => n + minor(l.net), 0n)),
    tax: amount(lines.reduce((n, l) => n + minor(l.tax), 0n)),
    gross: amount(lines.reduce((n, l) => n + minor(l.gross), 0n)),
    legalStatus: "review-required" as const,
  };
}
export function renderInvoiceHTML(invoice: InvoiceDraft): string {
  const validation = validateInvoice(invoice);
  if (!validation.valid)
    throw Error(validation.issues.map((i) => i.message).join(" "));
  const escape = (v: unknown) =>
    String(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const c = invoice.calculation,
    b = c.snapshot.config.business,
    o = c.snapshot.order;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Invoice ${escape(invoice.details.number)}</title><style>body{font:16px/1.5 system-ui;max-width:960px;margin:32px auto;padding:0 20px;color:#111;background:#fff}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style></head><body><main><h1>${b.environment === "test" ? "TEST " : ""}Invoice draft ${escape(invoice.details.number)}</h1><p>Issued: ${escape(invoice.details.issuedOn)} · Transaction: ${escape(o.date)} · ${escape(c.currency)}</p><h2>${escape(b.name)}</h2><pre>${escape(b.address)}</pre><p>Registration: ${escape(b.registrationId ?? "")}</p><h2>Bill / deliver to</h2><p>${escape(o.buyer.name)}</p><pre>${escape(o.buyer.address ?? "")}</pre><p>${escape(o.buyer.registrationId ?? "")} ${escape(o.buyer.stateCode ?? "")}</p><p>Place of supply: ${escape(o.placeOfSupply ?? o.jurisdiction)} · Reverse charge: no (ordinary domestic profile)</p><table><thead><tr><th>Item / classification</th><th>Quantity / unit</th><th>Unit price</th><th>Discount</th><th>Net</th><th>Rate</th></tr></thead><tbody>${c.lines.map((l) => `<tr><td>${escape(l.description)} / ${escape(l.classification)}</td><td>${l.quantity} ${escape(l.unit)}</td><td>${escape(l.unitPrice)}</td><td>${escape(l.discount)}</td><td>${escape(l.net)}</td><td>${escape(l.rate)}%${b.country === "JP" && l.rate === "8" ? " (reduced rate)" : ""}</td></tr>`).join("")}</tbody></table><h2>Tax by rate</h2>${c.groups.map((g) => `<p>${escape(g.rate)}% · ${escape(g.treatment)} · Net ${escape(g.net)} · Tax ${escape(g.tax)} · Gross ${escape(g.gross)}</p><ul>${g.components.map((p) => `<li>${escape(p.name)} ${escape(p.rate)}%: ${escape(p.amount)}</li>`).join("")}</ul>`).join("")}<p>Total net: ${escape(c.net)} · Total tax: ${escape(c.tax)}</p><h2>Total ${escape(c.gross)} ${escape(c.currency)}</h2><p>${escape(b.india?.declaration ?? "")}</p><p>Signature evidence: ${escape(invoice.details.signatureEvidence ?? "")}</p>${invoice.details.externalRegistration ? `<p>IRN: ${escape(invoice.details.externalRegistration.irn)}</p><p>Verified QR evidence is stored with the draft. Attach the actual signed QR when issuing the statutory document.</p>` : ""}<p>Draft for review. Not government registration or proof of legal compliance.</p></main></body></html>`;
}
