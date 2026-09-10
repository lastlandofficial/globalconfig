import { currencyDigits, getCountry } from "../countries";
import { D, freeze, rounding } from "../internal";
import { validateComplianceConfig, validateOrder, money } from "./validation";
import {
  copy,
  digest,
  issue,
  createReviewedTaxProvider,
  requirements,
} from "./rules";
import type {
  Calculation,
  CalculatedLine,
  ComplianceConfig,
  ComplianceIssue,
  Order,
  Result,
  TaxGroup,
  TreatmentRule,
} from "./types";
/** Largest-remainder allocation in integer units; stable input order breaks ties. */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  if (total < 0n || weights.some((w) => w < 0n))
    throw Error("Allocation inputs must be nonnegative.");
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (!sum) {
    if (total) throw Error("Cannot allocate a nonzero amount to zero weights.");
    return weights.map(() => 0n);
  }
  const values = weights.map((w) => (total * w) / sum);
  const remainders = weights
    .map((w, i) => ({ i, r: (total * w) % sum }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  let remaining = total - values.reduce((a, b) => a + b, 0n);
  for (const { i } of remainders) {
    if (!remaining) break;
    values[i] = values[i]! + 1n;
    remaining--;
  }
  return values;
}
export function calculateOrder(
  configInput: ComplianceConfig,
  orderInput: Order,
): Result<Calculation> {
  try {
    const config = copy(validateComplianceConfig(configInput));
    const country = getCountry(config.business.country);
    const digits = currencyDigits(country.currency);
    const scale = new D(10).pow(digits);
    const minor = (v: string) => BigInt(new D(v).mul(scale).toFixed(0));
    const amount = (v: bigint) =>
      new D(v.toString()).div(scale).toFixed(digits);
    const order = copy(validateOrder(orderInput, digits));
    const missing: ComplianceIssue[] = [];
    if (
      order.scenario !== "ordinary-domestic" ||
      order.buyer.country !== country.code
    )
      return {
        status: "unsupported",
        issues: [
          issue(
            "SUPPLY-UNSUPPORTED",
            "scenario",
            "Only reviewed ordinary domestic transactions are implemented.",
            "Use a separately reviewed implementation for cross-border, reverse-charge, marketplace or special supplies.",
          ),
        ],
      };
    if (
      country.code === "US"
        ? !/^US-CA(?:\/.+)?$/.test(order.jurisdiction)
        : order.jurisdiction !== country.code
    )
      return {
        status: "unsupported",
        issues: [
          issue(
            "JURISDICTION-UNSUPPORTED",
            "jurisdiction",
            "This jurisdiction has no executable profile.",
            "Use IN, JP, or an explicit US-CA jurisdiction with reviewed combined rates.",
          ),
        ],
      };
    if (!config.business.review || order.date >= config.business.review.after)
      missing.push(
        issue(
          "BUSINESS-REVIEW",
          "business.review",
          "Business scope review is missing or expired.",
          "Record the registration, invoice and treatment applicability review.",
        ),
      );
    if (config.business.registration === "unknown")
      missing.push(
        issue(
          "REGISTRATION-UNKNOWN",
          "business.registration",
          "Registration status has not been determined.",
          "Record the reviewed registration decision.",
        ),
      );
    if (config.business.registration === "unregistered")
      return {
        status: "unsupported",
        issues: [
          issue(
            "REGISTRATION-UNSUPPORTED",
            "business.registration",
            "This profile implements registered-business tax invoices.",
            "Review the appropriate receipt or non-tax document workflow.",
          ),
        ],
      };
    for (const expected of requirements.filter(
      (r) => r.country === country.code,
    )) {
      const r = config.rules.requirements.find((r) => r.id === expected.id);
      if (
        !r ||
        ["source", "provision", "scope", "country"].some(
          (k) =>
            r[k as keyof typeof r] !== expected[k as keyof typeof expected],
        )
      )
        return {
          status: "invalid",
          issues: [
            issue(
              "REQUIREMENT-PACK",
              "rules.requirements",
              "Required profile definitions are missing or modified.",
              "Use the bundled profile definitions; extend with separate custom IDs.",
            ),
          ],
        };
      if (order.date >= r.reviewAfter)
        missing.push(
          issue(
            "SOURCE-REVIEW",
            `rules.requirements.${r.id}`,
            "The scheduled requirement review is due.",
            "Review the source and scope before renewing the rule pack.",
            r.source,
          ),
        );
    }
    if (country.code === "IN") {
      if (!order.supply)
        missing.push(
          issue(
            "IN-SUPPLY",
            "supply",
            "Intra/inter-state treatment is unknown.",
            "Supply the reviewed treatment; it is not inferred from addresses.",
          ),
        );
      if (order.supply === "intra-state" && !order.localTax)
        missing.push(
          issue(
            "IN-LOCAL-TAX",
            "localTax",
            "Choose SGST or UTGST for this supply.",
            "Record the applicable local-tax component.",
          ),
        );
      if (order.supply === "inter-state" && order.localTax)
        throw Error("Inter-state supplies cannot specify localTax.");
    } else if (order.supply || order.localTax || order.placeOfSupply)
      throw Error("India supply fields cannot be used for this country.");
    const provider = createReviewedTaxProvider(config.rules.treatments);
    const selected: {
      product: ComplianceConfig["products"][number];
      rule: TreatmentRule;
      line: Order["lines"][number];
      charge: bigint;
      discount: bigint;
    }[] = [];
    for (const [i, line] of order.lines.entries()) {
      const product = config.products.find((p) => p.id === line.productId);
      if (!product) {
        missing.push(
          issue(
            "PRODUCT-UNKNOWN",
            `lines.${i}.productId`,
            "Product is not in the trusted catalog.",
            "Add and review the catalog item.",
          ),
        );
        continue;
      }
      const resolved = provider.resolve(
        product.id,
        order.jurisdiction,
        order.date,
      );
      if (resolved.status !== "ready") {
        missing.push(...resolved.issues);
        continue;
      }
      const rule = resolved.value;
      if (
        country.code === "JP" &&
        rule.treatment === "taxable" &&
        ![8, 10].includes(Number(rule.rate))
      )
        return {
          status: "unsupported",
          issues: [
            issue(
              "JP-RATE",
              "rate",
              "The Japan profile supports reviewed 8% and 10% categories.",
              "Use a separately reviewed historical or special-rate implementation.",
            ),
          ],
        };
      const total = new D(product.unitPrice).mul(line.quantity);
      const discount = money(line.discount ?? "0", digits, "Line discount");
      if (discount.gt(total))
        throw Error("Line discount exceeds the line price.");
      selected.push({
        product,
        rule,
        line,
        charge: minor(total.minus(discount).toFixed(digits)),
        discount: minor(discount.toFixed(digits)),
      });
    }
    if (missing.length) return { status: "needs-context", issues: missing };
    const orderDiscount = minor(order.discount ?? "0");
    if (orderDiscount > selected.reduce((n, l) => n + l.charge, 0n))
      throw Error("Order discount exceeds the subtotal.");
    const discounts = allocate(
      orderDiscount,
      selected.map((l) => l.charge),
    );
    const lines: CalculatedLine[] = selected.map(
      ({ product, rule, line, discount }, i) => ({
        id: line.id,
        productId: product.id,
        description: product.description,
        classification: product.classification ?? "",
        unit: product.unit ?? "",
        quantity: line.quantity,
        unitPrice: product.unitPrice,
        discount: amount(discount + discounts[i]!),
        treatment: rule.treatment,
        rate: new D(rule.rate).toString(),
        ruleId: rule.id,
        net: "",
        tax: "",
        gross: "",
      }),
    );
    const groupsByKey = new Map<string, number[]>();
    selected.forEach(({ rule }, i) => {
      const key = `${rule.treatment}/${new D(rule.rate).toString()}`;
      const indexes = groupsByKey.get(key) ?? [];
      indexes.push(i);
      groupsByKey.set(key, indexes);
    });
    const groups: TaxGroup[] = [];
    for (const indexes of groupsByKey.values()) {
      const first = selected[indexes[0]!]!;
      const rate = new D(first.rule.rate);
      const charges = indexes.map((i) => selected[i]!.charge - discounts[i]!);
      const charge = charges.reduce((a, b) => a + b, 0n);
      const base = new D(amount(charge));
      const rawTax =
        order.pricing === "inclusive"
          ? base.mul(rate).div(rate.plus(100))
          : base.mul(rate).div(100);
      const intra = country.code === "IN" && order.supply === "intra-state";
      const tax = intra
        ? rawTax
            .div(2)
            .toDecimalPlaces(digits, rounding(config.rounding))
            .mul(2)
        : rawTax.toDecimalPlaces(digits, rounding(config.rounding));
      const totalTax = minor(tax.toFixed(digits));
      const taxes = allocate(totalTax, charges);
      for (const [j, i] of indexes.entries()) {
        const c = charges[j]!;
        const t = taxes[j]!;
        const net = order.pricing === "inclusive" ? c - t : c;
        if (net < 0n)
          throw Error(
            "Rounding produced negative net value; choose a supported rounding policy for this amount.",
          );
        lines[i]!.net = amount(net);
        lines[i]!.tax = amount(t);
        lines[i]!.gross = amount(net + t);
      }
      const net = order.pricing === "inclusive" ? charge - totalTax : charge;
      const components = intra
        ? [
            {
              name: "CGST",
              rate: rate.div(2).toString(),
              amount: tax.div(2).toFixed(digits),
            },
            {
              name: order.localTax!,
              rate: rate.div(2).toString(),
              amount: tax.div(2).toFixed(digits),
            },
          ]
        : [
            {
              name:
                country.code === "IN"
                  ? "IGST"
                  : country.code === "JP"
                    ? "Consumption tax"
                    : order.jurisdiction,
              rate: rate.toString(),
              amount: tax.toFixed(digits),
            },
          ];
      groups.push({
        treatment: first.rule.treatment,
        rate: rate.toString(),
        net: amount(net),
        tax: amount(totalTax),
        gross: amount(net + totalTax),
        components,
      });
    }
    const sum = (field: "net" | "tax" | "gross" | "discount") =>
      lines.reduce((n, l) => n.plus(l[field]), new D(0)).toFixed(digits);
    const body = {
      engine: "glocon-order-1" as const,
      currency: country.currency,
      country: country.code,
      lines,
      groups,
      net: sum("net"),
      tax: sum("tax"),
      gross: sum("gross"),
      discount: sum("discount"),
      snapshot: { config, order },
      limitations: [
        "Reviewed transaction inputs are supplied by the business; registration, product classification and jurisdiction are not determined automatically.",
        "Line tax amounts are allocations of rate-group totals, not independently rounded tax amounts.",
        "This result is a calculation, not government registration, a tax return or compliance certification.",
      ],
    };
    return {
      status: "ready",
      value: freeze({ ...body, digest: digest(body) }),
    };
  } catch (e) {
    return {
      status: "invalid",
      issues: [
        issue(
          "INVALID-INPUT",
          "input",
          e instanceof Error ? e.message : String(e),
          "Correct the input using the configuration and transaction schemas.",
        ),
      ],
    };
  }
}
/** Recompute saved inputs. A digest detects changes; it is not a signature or authenticity proof. */
export function verifyCalculation(value: Calculation): boolean {
  try {
    if (value.engine !== "glocon-order-1") return false;
    const replay = calculateOrder(value.snapshot.config, value.snapshot.order);
    return replay.status === "ready" && digest(replay.value) === digest(value);
  } catch {
    return false;
  }
}
