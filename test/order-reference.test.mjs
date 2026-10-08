import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOrder,
  createComplianceExample,
} from "../dist/compliance/index.js";

// Independent integer/rational oracle. No decimal.js, engine helpers, or calculated totals.
const round = (n, d, mode) => {
  const whole = n / d,
    remainder = n % d;
  if (mode === "down") return whole;
  if (mode === "up") return whole + (remainder > 0n ? 1n : 0n);
  const comparison = remainder * 2n - d;
  return (
    whole +
    (comparison > 0n ||
    (comparison === 0n && (mode === "half-up" || whole % 2n === 1n))
      ? 1n
      : 0n)
  );
};
const decimal = (units, digits) =>
  digits
    ? `${units / 100n}.${String(units % 100n).padStart(2, "0")}`
    : String(units);
function discountShares(total, weights) {
  const denominator = weights.reduce((a, b) => a + b, 0n);
  if (denominator === 0n) {
    assert.equal(total, 0n);
    return weights.map(() => 0n);
  }
  const quotas = weights.map((weight) => ({
    whole: (total * weight) / denominator,
    numerator: (total * weight) % denominator,
  }));
  let unassigned = total - quotas.reduce((sum, q) => sum + q.whole, 0n);
  // Select the largest unused fractional quota without the engine's sorting algorithm.
  const awarded = new Set();
  while (unassigned > 0n) {
    let best = -1;
    for (let i = 0; i < quotas.length; i++)
      if (
        !awarded.has(i) &&
        (best === -1 || quotas[i].numerator > quotas[best].numerator)
      )
        best = i;
    quotas[best].whole++;
    awarded.add(best);
    unassigned--;
  }
  return quotas.map((q) => q.whole);
}
let seed = 0x4c4f434f;
const random = (max) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed >>> 8) % max;
};

test("1500 seeded orders match an independent exact rational accounting oracle", () => {
  const coverage = new Set();
  const mixedCountries = new Set();
  for (let sample = 0; sample < 1500; sample++) {
    const country = ["IN", "JP", "US"][sample % 3];
    const { config, order } = createComplianceExample(country);
    const digits = country === "JP" ? 0 : 2;
    const mode = ["half-up", "half-even", "down", "up"][random(4)];
    config.rounding = mode;
    const inclusive = random(2) === 1;
    order.pricing = inclusive ? "inclusive" : "exclusive";
    if (country === "IN")
      config.indiaRounding = sample % 2 ? "components" : "combined";
    const policy = config.indiaRounding ?? "components";
    coverage.add(`${country}/${mode}/${order.pricing}`);
    const template = config.rules.treatments[0];
    config.products = [];
    config.rules.treatments = [];
    order.lines = [];
    const count = 1 + random(5),
      charges = [],
      rates = [];
    for (let i = 0; i < count; i++) {
      const price = BigInt(1000 + random(100000));
      const quantity = 1 + random(9),
        discount = BigInt(random(500));
      const rate = (
        country === "JP"
          ? ["8", "10"]
          : country === "IN"
            ? ["5", "12", "18", "28"]
            : ["7.25", "8.875", "9.5"]
      )[random(country === "JP" ? 2 : country === "IN" ? 4 : 3)];
      config.products.push({
        id: `p${i}`,
        description: `Reviewed fixture ${i}`,
        unitPrice: decimal(price, digits),
        classification: "0000",
        unit: "each",
      });
      config.rules.treatments.push({
        ...template,
        id: `r${i}`,
        productId: `p${i}`,
        rate,
      });
      order.lines.push({
        id: `l${i}`,
        productId: `p${i}`,
        quantity,
        discount: decimal(discount, digits),
      });
      charges.push(price * BigInt(quantity) - discount);
      rates.push(rate);
    }
    const chargeTotal = charges.reduce((a, b) => a + b, 0n);
    const orderDiscount = BigInt(
      random(Number(chargeTotal < 1000n ? chargeTotal + 1n : 1000n)),
    );
    order.discount = decimal(orderDiscount, digits);
    const discounts = discountShares(orderDiscount, charges);
    const groups = new Map();
    for (let i = 0; i < count; i++)
      groups.set(
        rates[i],
        (groups.get(rates[i]) ?? 0n) + charges[i] - discounts[i],
      );
    if (groups.size > 1) mixedCountries.add(country);
    let netTotal = 0n,
      taxTotal = 0n;
    const expected = new Map();
    for (const [rate, charge] of groups) {
      const [whole, fraction = ""] = rate.split(".");
      const rateDenominator = 10n ** BigInt(fraction.length),
        rateNumerator = BigInt(whole + fraction);
      const denominator =
        100n * rateDenominator + (inclusive ? rateNumerator : 0n);
      const numerator = charge * rateNumerator;
      const intra = country === "IN";
      const tax =
        intra && policy === "components"
          ? round(numerator, denominator * 2n, mode) * 2n
          : round(numerator, denominator, mode);
      const net = inclusive ? charge - tax : charge;
      expected.set(rate, {
        net: decimal(net, digits),
        tax: decimal(tax, digits),
        gross: decimal(net + tax, digits),
      });
      netTotal += net;
      taxTotal += tax;
    }
    const result = calculateOrder(config, order);
    assert.equal(
      result.status,
      "ready",
      `sample ${sample}: ${JSON.stringify(result)}`,
    );
    const actual = result.value;
    assert.deepEqual(
      { net: actual.net, tax: actual.tax, gross: actual.gross },
      {
        net: decimal(netTotal, digits),
        tax: decimal(taxTotal, digits),
        gross: decimal(netTotal + taxTotal, digits),
      },
      `sample ${sample}`,
    );
    for (const group of actual.groups)
      assert.deepEqual(
        { net: group.net, tax: group.tax, gross: group.gross },
        expected.get(group.rate),
        `group ${group.rate}, sample ${sample}`,
      );
  }
  assert.equal(
    coverage.size,
    24,
    "Every country/rounding/pricing combination must run",
  );
  assert.equal(
    mixedCountries.size,
    3,
    "Every country must include mixed-rate orders",
  );
});

test("1500 metered orders match a rational oracle for line and tax rounding", () => {
  const combinations = new Set();
  for (let sample = 0; sample < 1500; sample++) {
    const country = ["IN", "JP", "US"][sample % 3];
    const { config, order } = createComplianceExample(country);
    const digits = country === "JP" ? 0 : 2,
      scale = digits ? 100n : 1n;
    const lineRounding = ["half-up", "half-even", "down", "up"][random(4)];
    const taxRounding = ["half-up", "half-even", "down", "up"][random(4)];
    const inclusive = random(2) === 1;
    order.pricing = inclusive ? "inclusive" : "exclusive";
    combinations.add(
      `${country}/${lineRounding}/${taxRounding}/${order.pricing}`,
    );
    config.billing = {
      quantityPrecision: 3,
      unitPricePrecision: 4,
      lineRounding,
      review: config.business.review,
    };
    config.rounding = taxRounding;
    if (country === "IN")
      config.indiaRounding = sample % 2 ? "components" : "combined";
    const template = config.rules.treatments[0];
    config.products = [];
    config.rules.treatments = [];
    order.lines = [];
    const charges = [],
      rates = [];
    const count = 1 + random(5);
    for (let i = 0; i < count; i++) {
      const price = BigInt(1000000 + random(10000000));
      const quantity = BigInt(10 + random(10000));
      const rawMinorFloor = (price * quantity * scale) / 10000000n;
      const lineDiscount = BigInt(
        random(Number(rawMinorFloor < 10n ? rawMinorFloor + 1n : 10n)),
      );
      const rate = (
        country === "JP"
          ? ["8", "10"]
          : country === "IN"
            ? ["5", "12", "18", "28"]
            : ["7.25", "8.875", "9.5"]
      )[random(country === "JP" ? 2 : country === "IN" ? 4 : 3)];
      const unitPrice = `${price / 10000n}.${String(price % 10000n).padStart(4, "0")}`;
      const exactQuantity = `${quantity / 1000n}.${String(quantity % 1000n).padStart(3, "0")}`;
      config.products.push({
        id: `p${i}`,
        description: `Metered fixture ${i}`,
        unitPrice,
        classification: "0000",
        unit: "metered unit",
      });
      config.rules.treatments.push({
        ...template,
        id: `r${i}`,
        productId: `p${i}`,
        rate,
      });
      order.lines.push({
        id: `l${i}`,
        productId: `p${i}`,
        quantity: exactQuantity,
        discount: decimal(lineDiscount, digits),
      });
      const denominator = 10000n * 1000n;
      charges.push(
        round(
          price * quantity * scale - lineDiscount * denominator,
          denominator,
          lineRounding,
        ),
      );
      rates.push(rate);
    }
    const subtotal = charges.reduce((a, b) => a + b, 0n);
    const orderDiscount = BigInt(
      random(Number(subtotal < 10n ? subtotal + 1n : 10n)),
    );
    order.discount = decimal(orderDiscount, digits);
    const allocations = discountShares(orderDiscount, charges);
    const groups = new Map();
    for (let i = 0; i < count; i++)
      groups.set(
        rates[i],
        (groups.get(rates[i]) ?? 0n) + charges[i] - allocations[i],
      );
    let netTotal = 0n,
      taxTotal = 0n;
    for (const [rate, charge] of groups) {
      const [whole, fraction = ""] = rate.split(".");
      const rateDenominator = 10n ** BigInt(fraction.length),
        rateNumerator = BigInt(whole + fraction);
      const denominator =
          100n * rateDenominator + (inclusive ? rateNumerator : 0n),
        numerator = charge * rateNumerator;
      const tax =
        country === "IN" && config.indiaRounding === "components"
          ? round(numerator, denominator * 2n, taxRounding) * 2n
          : round(numerator, denominator, taxRounding);
      netTotal += inclusive ? charge - tax : charge;
      taxTotal += tax;
    }
    const result = calculateOrder(config, order);
    assert.equal(
      result.status,
      "ready",
      `metered sample ${sample}: ${JSON.stringify(result)}`,
    );
    assert.deepEqual(
      {
        net: result.value.net,
        tax: result.value.tax,
        gross: result.value.gross,
      },
      {
        net: decimal(netTotal, digits),
        tax: decimal(taxTotal, digits),
        gross: decimal(netTotal + taxTotal, digits),
      },
      `metered sample ${sample}`,
    );
  }
  assert.equal(
    combinations.size,
    96,
    "Every country/line-rounding/tax-rounding/pricing combination must run",
  );
});
