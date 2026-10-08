import test from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "decimal.js";
import {
  convertCurrency,
  createCurrencyConverter,
  formatCurrency,
  fromMinorUnits,
  toMinorUnits,
} from "../dist/currency.js";

const rates = {
  base: "USD",
  rates: { INR: "83.25", JPY: "150" },
  asOf: "2026-09-01T00:00:00Z",
  source: "Test fixture — not market data",
};
const convert = (overrides = {}) =>
  convertCurrency({
    amount: "10",
    from: "USD",
    to: "INR",
    rates,
    ...overrides,
  });

test("converts direct, inverse, and cross rates", () => {
  assert.equal(convert().amount, "832.50");
  assert.equal(
    convert({ amount: "832.50", from: "INR", to: "USD" }).amount,
    "10.00",
  );
  assert.equal(
    convert({ amount: "832.50", from: "INR", to: "JPY" }).amount,
    "1500",
  );
  assert.equal(convert().source, rates.source);
});
test("same-currency conversion does not need a missing quote", () => {
  assert.equal(
    convert({
      amount: "-1.005",
      from: "INR",
      to: "INR",
      rates: { ...rates, rates: {} },
    }).amount,
    "-1.01",
  );
});
test("exact decimal rounding includes half-even and JPY", () => {
  assert.equal(toMinorUnits("1.005", "USD"), 101n);
  assert.equal(toMinorUnits("1.005", "USD", "half-even"), 100n);
  assert.equal(toMinorUnits("-1.005", "USD"), -101n);
  assert.equal(toMinorUnits("1.5", "JPY"), 2n);
  assert.equal(fromMinorUnits(101n, "USD"), "1.01");
  assert.equal(fromMinorUnits("-150", "JPY"), "-150");
});
test("large amounts retain precision when formatted", () => {
  assert.equal(
    formatCurrency("9007199254740993.12", "USD"),
    "$9,007,199,254,740,993.12",
  );
  assert.equal(formatCurrency("1234567.89", "INR"), "₹12,34,567.89");
  assert.equal(formatCurrency("1500.5", "JPY"), "￥1,501");
});

test("legacy Intl preserves exact currency digits, grouping, signs and locale numerals", () => {
  const Original = Intl.NumberFormat;
  const cases = [];
  for (const locale of [
    "en-US",
    "en-IN",
    "ja-JP",
    "fr-FR",
    "ar-EG",
    "hi-IN-u-nu-deva",
    "zh-Hans-CN-u-nu-hanidec",
    "es-ES",
    "pl-PL",
  ]) {
    for (const currency of ["USD", "INR", "JPY"]) {
      for (const amount of [
        "9007199254740993.01",
        "999999999999999999999999999999.99",
        "-9007199254740993.12",
        "-0.001",
        "1234.56",
        "12345.67",
        "1.005",
      ]) {
        // Whole-yen rounding of the maximal fractional amount would cross the money bound.
        const boundedAmount =
          currency === "JPY" && amount === "999999999999999999999999999999.99"
            ? "999999999999999999999999999999"
            : amount;
        for (const currencyDisplay of ["symbol", "narrowSymbol", "code"]) {
          const options = { locale, currencyDisplay };
          cases.push({
            amount: boundedAmount,
            currency,
            options,
            expected: formatCurrency(boundedAmount, currency, options),
          });
        }
      }
    }
  }
  class Legacy extends Original {
    get format() {
      const format = super.format;
      return (value) => format(Number(value));
    }
    formatToParts(value) {
      return super.formatToParts(Number(value));
    }
  }
  Intl.NumberFormat = Legacy;
  try {
    for (const entry of cases)
      assert.equal(
        formatCurrency(entry.amount, entry.currency, entry.options),
        entry.expected,
        JSON.stringify(entry),
      );
    assert.equal(
      formatCurrency("1.01", "USD", { currencyDisplay: "name" }),
      "1.01 US dollars",
    );
    assert.throws(
      () =>
        formatCurrency("9007199254740993.01", "USD", {
          currencyDisplay: "name",
        }),
      /decimal-string Intl support/,
    );
  } finally {
    Intl.NumberFormat = Original;
  }
  assert.equal(
    formatCurrency("9007199254740993.01", "USD"),
    "$9,007,199,254,740,993.01",
  );
});
test("host Decimal configuration cannot change calculations", () => {
  const precision = Decimal.precision;
  Decimal.set({ precision: 2 });
  try {
    assert.equal(convert().amount, "832.50");
  } finally {
    Decimal.set({ precision });
  }
});
test("rejects non-finite, malformed, excessive, or unsupported money", () => {
  for (const amount of [
    NaN,
    Infinity,
    "",
    "1e3",
    "0x10",
    "1,000",
    " 1",
    null,
    {},
    "1.0000000000000000001",
    "1000000000000000000000000000000",
  ])
    assert.throws(() => convert({ amount }));
  assert.throws(() => toMinorUnits("1", "EUR"));
  assert.throws(() => fromMinorUnits("1.2", "USD"));
  assert.throws(() => fromMinorUnits(123, "USD"));
  assert.throws(() => toMinorUnits("1", "USD", "invalid"));
});
test("validates exchange rate values, base, and metadata", () => {
  for (const patch of [
    { rates: {} },
    { rates: { INR: "0" } },
    { rates: { INR: "-1" } },
    { rates: { INR: "1", USD: "2" } },
    { source: "" },
    { asOf: "2026-01-01" },
    { rates: { INR: "1", EUR: "1" } },
  ])
    assert.throws(() => convert({ rates: { ...rates, ...patch } }));
});
test("freshness handles stale, future, and boundary timestamps", () => {
  assert.equal(
    convert({ maxAgeMs: 1000, now: new Date("2026-09-01T00:00:01Z") }).amount,
    "832.50",
  );
  assert.throws(
    () => convert({ maxAgeMs: 999, now: new Date("2026-09-01T00:00:01Z") }),
    /stale/,
  );
  assert.throws(
    () => convert({ maxAgeMs: 1000, now: new Date("2026-08-31T23:59:59Z") }),
    /future/,
  );
  assert.throws(() => convert({ maxAgeMs: -1 }));
});
test("FX dates reject impossible calendar days and rollover hours", () => {
  for (const asOf of [
    "2026-02-30T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
  ])
    assert.throws(() => convert({ rates: { ...rates, asOf } }));
});
test("async adapters fetch explicitly and propagate failures", async () => {
  const converter = createCurrencyConverter(async () => rates);
  assert.equal(
    (await converter({ amount: "10", from: "USD", to: "INR" })).amount,
    "832.50",
  );
  await assert.rejects(
    createCurrencyConverter(async () => {
      throw new Error("provider unavailable");
    })({ amount: "10", from: "USD", to: "INR" }),
    /provider unavailable/,
  );
});

test("minor-unit encoding and decoding share exact bounds including rounding carry", () => {
  for (const currency of ["USD", "INR", "JPY"]) {
    const tail = currency === "JPY" ? "" : ".99";
    for (const sign of ["", "-"]) {
      const value = sign + "9".repeat(30) + tail;
      assert.equal(
        fromMinorUnits(toMinorUnits(value, currency), currency),
        value,
      );
    }
    assert.throws(
      () =>
        toMinorUnits(
          "9".repeat(30) + (currency === "JPY" ? ".5" : ".995"),
          currency,
        ),
      /below 1e30/,
    );
    assert.throws(
      () =>
        fromMinorUnits(
          "1" + "0".repeat(currency === "JPY" ? 30 : 32),
          currency,
        ),
      /below 1e30/,
    );
  }
  assert.equal(fromMinorUnits("-0000000", "USD"), "0.00");
  assert.equal(fromMinorUnits("00000101", "USD"), "1.01");
  assert.equal(
    fromMinorUnits(toMinorUnits("10000000000000000000000000000", "USD"), "USD"),
    "10000000000000000000000000000.00",
  );
});

test("cross-rate cancellation preserves exact ties and directed rounding", () => {
  for (const [amount, source, target, rounding, expected] of [
    ["0.13", "26", "1", "half-up", "0.01"],
    ["-0.13", "26", "1", "half-up", "-0.01"],
    ["0.07", "7", "1", "down", "0.01"],
    ["-0.21", "7", "1", "down", "-0.03"],
    ["0.14", "28", "13", "half-up", "0.07"],
    ["0.14", "28", "13", "half-even", "0.06"],
    ["0.035", "7", "1", "up", "0.01"],
    ["-0.035", "7", "1", "half-even", "-0.00"],
  ]) {
    assert.equal(
      convertCurrency({
        amount,
        from: "USD",
        to: "INR",
        rounding,
        rates: { ...rates, base: "JPY", rates: { USD: source, INR: target } },
      }).amount,
      expected,
      JSON.stringify({ amount, source, target, rounding }),
    );
  }
});

// The oracle uses a fixed 18-place integer grid and nearest-neighbor distances,
// independently of Decimal and the conversion's per-value fraction encoding.
const referenceScale = 10n ** 18n;
function referenceCoefficient(value) {
  const [integer, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  return BigInt(integer) * referenceScale + BigInt(fraction.padEnd(18, "0"));
}
function referenceConversion(amount, source, target, digits, mode) {
  const numerator =
    referenceCoefficient(amount) *
    referenceCoefficient(target) *
    10n ** BigInt(digits);
  const denominator = referenceCoefficient(source) * referenceScale;
  const lower = numerator / denominator;
  const distanceBelow = numerator - lower * denominator;
  const distanceAbove = (lower + 1n) * denominator - numerator;
  let units = lower;
  if (
    (mode === "up" && distanceBelow !== 0n) ||
    ((mode === "half-up" || mode === "half-even") &&
      distanceBelow > distanceAbove) ||
    (distanceBelow === distanceAbove &&
      (mode === "half-up" || (mode === "half-even" && lower % 2n !== 0n)))
  )
    units++;
  const text = units.toString().padStart(digits + 1, "0");
  const fixed = digits
    ? `${text.slice(0, -digits)}.${text.slice(-digits)}`
    : text;
  return amount.startsWith("-") && referenceCoefficient(amount) !== 0n
    ? `-${fixed}`
    : fixed;
}

test("cross-rate results agree with an independent integer oracle across cancellation and boundary cases", () => {
  const samples = [
    ["999999999999999999999999999999.99", "26", "1"],
    ["0.000000000000000001", "0.000000000000000007", "0.13"],
    ["9007199254740993.01", "1.23", "0.000000000000000007"],
    ["0.123456789012345678", "0.17", "28.999999999999999999"],
  ];
  for (let denominator = 2; denominator <= 80; denominator++) {
    samples.push([(denominator / 200).toFixed(3), String(denominator), "1"]);
    samples.push([(denominator / 100).toFixed(2), String(denominator), "13"]);
  }
  for (const [unsignedAmount, source, target] of samples) {
    for (const sign of ["", "-"]) {
      const amount = sign + unsignedAmount;
      for (const [to, digits] of [
        ["INR", 2],
        ["JPY", 0],
      ]) {
        for (const rounding of ["half-up", "half-even", "down", "up"]) {
          const result = convertCurrency({
            amount,
            from: "USD",
            to,
            rounding,
            rates: {
              ...rates,
              base: "INR",
              rates: { USD: source, JPY: target },
            },
          });
          // INR is the base quote, while JPY exercises the independent target quote.
          const expected = referenceConversion(
            amount,
            source,
            to === "INR" ? "1" : target,
            digits,
            rounding,
          );
          assert.equal(
            result.amount,
            expected,
            JSON.stringify({ amount, source, target, to, rounding }),
          );
        }
      }
    }
  }
});

test("quote normalization excludes inherited values and reads getters once", () => {
  for (const inherited of ["-83", "83"]) {
    assert.throws(
      () =>
        convert({
          rates: { ...rates, rates: Object.create({ INR: inherited }) },
        }),
      /Missing exchange rate/,
    );
  }
  let quoteReads = 0;
  let baseReads = 0;
  let ratesReads = 0;
  const quotes = {
    get USD() {
      return ++baseReads === 1 ? "1" : "2";
    },
    get INR() {
      return ++quoteReads === 1 ? "83.25" : "-1";
    },
  };
  const provided = {
    ...rates,
    get rates() {
      ratesReads++;
      return quotes;
    },
  };
  assert.equal(convert({ rates: provided }).amount, "832.50");
  assert.equal(quoteReads, 1);
  assert.equal(baseReads, 1);
  assert.equal(ratesReads, 1);
  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, "INR", { value: "83.25" });
  assert.equal(
    convert({ rates: { ...rates, rates: nonEnumerable } }).amount,
    "832.50",
  );
  Object.defineProperty(nonEnumerable, "USD", { value: "2" });
  assert.throws(
    () => convert({ rates: { ...rates, rates: nonEnumerable } }),
    /base currency rate/,
  );
  for (const invalid of [null, [], "83.25"])
    assert.throws(
      () => convert({ rates: { ...rates, rates: invalid } }),
      /must be an object/,
    );
});

test("computed currency amounts remain within the money helper range", () => {
  for (const sign of ["", "-"]) {
    assert.throws(
      () =>
        convert({
          amount: sign + "9".repeat(30),
          rates: { ...rates, rates: { INR: "2" } },
        }),
      /Converted money.*below 1e30/,
    );
    for (const currency of ["USD", "JPY"]) {
      const amount =
        sign + "9".repeat(30) + (currency === "JPY" ? ".5" : ".995");
      assert.throws(() => formatCurrency(amount, currency), /below 1e30/);
      assert.throws(
        () => convertCurrency({ amount, from: currency, to: currency, rates }),
        /below 1e30/,
      );
    }
  }
  const accepted = convert({
    amount: "9".repeat(30) + ".99",
    rates: { ...rates, rates: { INR: "1" } },
  });
  assert.equal(
    fromMinorUnits(toMinorUnits(accepted.amount, "INR"), "INR"),
    accepted.amount,
  );
  assert.match(formatCurrency(accepted.amount, "INR"), /99$/);
});

test("raw decimal and minor-unit strings are bounded before parsing padded input", () => {
  const accepted = "0".repeat(1023) + "1";
  assert.equal(toMinorUnits(accepted, "USD"), 100n);
  assert.equal(fromMinorUnits(accepted, "USD"), "0.01");
  for (const value of ["0".repeat(1024) + "1", "1." + "0".repeat(200000)]) {
    assert.throws(() => toMinorUnits(value, "USD"), /at most 1024 characters/);
    assert.throws(
      () => formatCurrency(value, "USD"),
      /at most 1024 characters/,
    );
    assert.throws(
      () => fromMinorUnits(value, "USD"),
      /at most 1024 characters/,
    );
    assert.throws(() => convert({ amount: value }), /at most 1024 characters/);
  }
  assert.equal(toMinorUnits("1." + "0".repeat(1022), "USD"), 100n);
});
