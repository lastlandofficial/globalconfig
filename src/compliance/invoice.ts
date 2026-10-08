import { D, dateOnly, freeze } from "../internal";
import { currencyDigits } from "../countries";
import { calculateOrder, verifyCalculation } from "./engine";
import { copy, digest, issue, requirements } from "./rules";
import { array, keys, obj, review, text } from "./validation";
import { quantityUnits } from "./billing";
import { quantityUnits as legacyQuantityUnits } from "./legacy-validation";
import type {
  Calculation,
  CalculatedLine,
  ComplianceConfig,
  ComplianceIssue,
  CreditNoteDraft,
  CreditNoteOptions,
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
    const selectedReviews = [
      b.review,
      c.snapshot.config.billing?.review,
      ...c.lines.map(
        (line) =>
          c.snapshot.config.rules.treatments.find(
            (rule) => rule.id === line.ruleId,
          )?.review,
      ),
    ].filter((review) => review !== undefined);
    if (
      d.issuedOn >= (b.review?.after ?? "") ||
      c.snapshot.config.rules.requirements.some(
        (r) => r.country === b.country && d.issuedOn >= r.reviewAfter,
      ) ||
      (c.engine === "glocon-order-3" &&
        (selectedReviews.some(
          (review) => d.issuedOn < review.on || d.issuedOn >= review.after,
        ) ||
          c.snapshot.config.rules.requirements.some(
            (r) => r.country === b.country && d.issuedOn < r.reviewedOn,
          )))
    )
      issues.push(
        issue(
          "ISSUE-REVIEW",
          "details.issuedOn",
          "Review evidence is outside its issuance period or was recorded after the issue date.",
          "Use an issue date covered by completed reviews and recalculate after renewing expired evidence.",
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
  options: CreditNoteOptions = {},
): Result<CreditNoteDraft> {
  try {
    if (!validateInvoice(original).valid)
      throw Error("Original invoice is invalid.");
    array(previous, "Credit history", 0, 10000);
    obj(options);
    keys(options, ["version"]);
    if (
      options.version !== undefined &&
      options.version !== 1 &&
      options.version !== 2
    )
      throw Error("Credit version must be 1 or 2.");
    const version =
      options.version ??
      (original.calculation.engine === "glocon-order-3" ||
      previous.some((credit) => credit?.version === 2)
        ? 2
        : 1);
    const units = (quantity: unknown) =>
      creditQuantityUnits(original, quantity);
    validateCreditRequest(original, request, version);
    const c = original.calculation,
      digits = currencyDigits(c.currency),
      scale = new D(10).pow(digits);
    const minor = (v: string) => BigInt(new D(v).mul(scale).toFixed(0));
    const amount = (v: bigint) =>
      new D(v.toString()).div(scale).toFixed(digits);
    const sources = new Map(
      c.lines.map((line) => [
        line.id,
        {
          line,
          quantity: units(line.quantity),
          net: minor(line.net),
          tax: minor(line.tax),
        },
      ]),
    );
    const used = new Map<
      string,
      { quantity: bigint; net: bigint; tax: bigint }
    >();
    const priorIds = new Set<string>();
    const priorNumbers = new Set<string>();
    // Legacy digests are accumulated once. Version 2 uses only the immediate
    // predecessor, while allocations always replay the entire supplied chain.
    const priorDigests: string[] = [];
    let lastDate = original.details.issuedOn;
    for (const credit of previous) {
      obj(credit);
      if (credit.version !== 1 && credit.version !== 2)
        throw Error("Unsupported credit history version.");
      validateCreditRequest(original, credit.request, credit.version);
      if (
        credit.originalDigest !== original.digest ||
        priorIds.has(credit.digest) ||
        priorNumbers.has(credit.request.number) ||
        credit.request.date < lastDate ||
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
        priorDigests,
        used,
        sources,
        units,
        minor,
        amount,
        credit.version,
      );
      const { digest: recordedDigest, ...recordedBody } = credit;
      if (
        recordedDigest !== digest(expected) ||
        digest(recordedBody) !== recordedDigest
      )
        throw Error("Credit history does not replay.");
      priorIds.add(credit.digest);
      priorNumbers.add(credit.request.number);
      priorDigests.push(credit.digest);
      lastDate = credit.request.date;
      for (const line of expected.lines) {
        const u = used.get(line.lineId) ?? { quantity: 0n, net: 0n, tax: 0n };
        used.set(line.lineId, {
          quantity: u.quantity + units(line.quantity),
          net: u.net + minor(line.net),
          tax: u.tax + minor(line.tax),
        });
      }
    }
    for (const line of request.lines)
      if (!sources.has(line.lineId)) throw Error("Unknown invoice line.");
    const body = creditBody(
      original,
      copy(request),
      priorDigests,
      used,
      sources,
      units,
      minor,
      amount,
      version,
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
function validateCreditRequest(
  original: InvoiceDraft,
  request: CreditRequest,
  version: 1 | 2,
) {
  obj(request);
  keys(request, ["number", "date", "reason", "review", "lines"]);
  text(request.number, "Credit number");
  text(request.reason, "Credit reason");
  dateOnly(request.date);
  review(request.review);
  if (
    request.date < original.details.issuedOn ||
    request.date >= request.review.after ||
    ((original.calculation.engine === "glocon-order-3" || version === 2) &&
      (request.date < request.review.on ||
        request.date < (request.review.appliesFrom ?? request.review.on)))
  )
    throw Error(
      "Credit date precedes the invoice or is outside its completed review period.",
    );
  array(request.lines, "Credit lines", 1);
  const ids = new Set<string>();
  for (const line of request.lines) {
    obj(line);
    keys(line, ["lineId", "quantity"]);
    text(line.lineId, "Line ID");
    if (version === 2)
      quantityUnits(
        line.quantity,
        original.calculation.snapshot.config.billing,
      );
    else creditQuantityUnits(original, line.quantity);
    if (ids.has(line.lineId))
      throw Error(
        "Credit lines require unique IDs and positive reviewed quantities.",
      );
    ids.add(line.lineId);
  }
}
function creditQuantityUnits(
  original: InvoiceDraft,
  quantity: unknown,
): bigint {
  const parse =
    original.calculation.engine === "glocon-order-3"
      ? quantityUnits
      : legacyQuantityUnits;
  return parse(quantity, original.calculation.snapshot.config.billing);
}
function creditBody(
  original: InvoiceDraft,
  request: CreditRequest,
  previousDigests: string[],
  used: Map<string, { quantity: bigint; net: bigint; tax: bigint }>,
  sources: ReadonlyMap<
    string,
    { line: CalculatedLine; quantity: bigint; net: bigint; tax: bigint }
  >,
  units: (quantity: unknown) => bigint,
  minor: (v: string) => bigint,
  amount: (v: bigint) => string,
  version: 1 | 2,
) {
  const lines = request.lines.map((l) => {
    const source = sources.get(l.lineId);
    const u = used.get(l.lineId) ?? { quantity: 0n, net: 0n, tax: 0n };
    const billedQuantity = units(l.quantity);
    if (!source || billedQuantity + u.quantity > source.quantity)
      throw Error("Credit exceeds remaining invoice quantity.");
    const numerator = billedQuantity + u.quantity,
      denominator = source.quantity;
    const net = (source.net * numerator) / denominator - u.net,
      tax = (source.tax * numerator) / denominator - u.tax;
    if (net < 0n || tax < 0n)
      throw Error("Credit history exceeds original amounts.");
    return {
      lineId: l.lineId,
      quantity: l.quantity,
      net: amount(net),
      tax: amount(tax),
      gross: amount(net + tax),
      rate: source.line.rate,
    };
  });
  const body = {
    kind: "credit-note" as const,
    status: "draft" as const,
    originalDigest: original.digest,
    originalNumber: original.details.number,
    originalDate: original.details.issuedOn,
    request,
    lines,
    net: amount(lines.reduce((n, l) => n + minor(l.net), 0n)),
    tax: amount(lines.reduce((n, l) => n + minor(l.tax), 0n)),
    gross: amount(lines.reduce((n, l) => n + minor(l.gross), 0n)),
    legalStatus: "review-required" as const,
  };
  return version === 1
    ? { ...body, version: 1 as const, previousDigests }
    : {
        ...body,
        version: 2 as const,
        previousDigest: previousDigests.at(-1) ?? null,
        historyLength: previousDigests.length,
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Invoice ${escape(invoice.details.number)}</title><style>body{font:16px/1.5 system-ui;max-width:960px;margin:32px auto;padding:0 20px;color:#111;background:#fff}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style></head><body><main><h1>${b.environment === "test" ? "TEST " : ""}Invoice draft ${escape(invoice.details.number)}</h1><p>Issued: ${escape(invoice.details.issuedOn)} · Transaction: ${escape(o.date)} · ${escape(c.currency)}</p><h2>${escape(b.name)}</h2><pre>${escape(b.address)}</pre><p>Registration: ${escape(b.registrationId ?? "")}</p><h2>Bill / deliver to</h2><p>${escape(o.buyer.name)}</p><pre>${escape(o.buyer.address ?? "")}</pre><p>${escape(o.buyer.registrationId ?? "")} ${escape(o.buyer.stateCode ?? "")}</p><p>Place of supply: ${escape(o.placeOfSupply ?? o.jurisdiction)} · Reverse charge: no (ordinary domestic profile)</p><table><thead><tr><th>Item / classification</th><th>Quantity / unit</th><th>Unit price</th><th>Discount</th><th>Net</th><th>Rate</th></tr></thead><tbody>${c.lines.map((l) => `<tr><td>${escape(l.description)} / ${escape(l.classification)}</td><td>${escape(l.quantity)} ${escape(l.unit)}</td><td>${escape(l.unitPrice)}</td><td>${escape(l.discount)}</td><td>${escape(l.net)}</td><td>${escape(l.rate)}%${b.country === "JP" && l.rate === "8" ? " (reduced rate)" : ""}</td></tr>`).join("")}</tbody></table><h2>Tax by rate</h2>${c.groups.map((g) => `<p>${escape(g.rate)}% · ${escape(g.treatment)} · Net ${escape(g.net)} · Tax ${escape(g.tax)} · Gross ${escape(g.gross)}</p><ul>${g.components.map((p) => `<li>${escape(p.name)} ${escape(p.rate)}%: ${escape(p.amount)}</li>`).join("")}</ul>`).join("")}<p>Total net: ${escape(c.net)} · Total tax: ${escape(c.tax)}</p><h2>Total ${escape(c.gross)} ${escape(c.currency)}</h2><p>${escape(b.india?.declaration ?? "")}</p><p>Signature evidence: ${escape(invoice.details.signatureEvidence ?? "")}</p>${invoice.details.externalRegistration ? `<p>IRN: ${escape(invoice.details.externalRegistration.irn)}</p><p>Verified QR evidence is stored with the draft. Attach the actual signed QR when issuing the statutory document.</p>` : ""}<p>Draft for review. Not government registration or proof of legal compliance.</p></main></body></html>`;
}
