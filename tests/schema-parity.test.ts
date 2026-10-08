import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  checkFinancialCases,
  createComplianceExample,
  createMeteredComplianceExample,
  createInvoiceDraft,
} from "../src/compliance";
import {
  validateComplianceConfig,
  validateOrder,
} from "../src/compliance/validation";

function schema(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../docs/compliance/${name}.schema.json`, import.meta.url),
      "utf8",
    ),
  );
}

const configSchema = schema("config");
const orderSchema = schema("order");
const casesSchema = schema("financial-cases");
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addSchema(orderSchema);
const configValid = ajv.compile(configSchema);
const orderValid = ajv.getSchema(orderSchema.$id)!;
const casesValid = ajv.compile(casesSchema);

function accepts(validate: () => unknown) {
  try {
    validate();
    return true;
  } catch {
    return false;
  }
}

describe("published financial schemas", () => {
  it("keeps shared lexical definitions identical while orders remain standalone", () => {
    for (const document of [orderSchema, casesSchema]) {
      for (const [name, definition] of Object.entries(document.$defs))
        if (name !== "invoiceDetails")
          expect(definition, `${document.title}: ${name}`).toEqual(
            configSchema.$defs[name],
          );
    }
    const standalone = new Ajv2020();
    addFormats(standalone);
    expect(
      standalone.compile(orderSchema)(createComplianceExample().order),
    ).toBe(true);
  });

  it("accepts the documented ordinary and metered workflows in all countries", () => {
    for (const country of ["IN", "JP", "US"] as const) {
      for (const create of [
        createComplianceExample,
        createMeteredComplianceExample,
      ]) {
        const { config, order, details, expected } = create(country);
        expect(configValid(config), JSON.stringify(configValid.errors)).toBe(
          true,
        );
        expect(orderValid(order), JSON.stringify(orderValid.errors)).toBe(true);
        const fixtures = [
          { name: `${country} fixture`, order, details, expected },
        ];
        expect(casesValid(fixtures), JSON.stringify(casesValid.errors)).toBe(
          true,
        );
        expect(checkFinancialCases(config, fixtures).exitCode).toBe(0);
      }
    }
  });

  it("matches runtime text bounds across business, transaction, and fixture names", () => {
    const samples = [
      ["", false],
      [" \t\n\u00a0\ufeff", false],
      ["x", true],
      ["  buyer  ", true],
      ["x".repeat(10000), true],
      ["x".repeat(10001), false],
      ["😀".repeat(10000), true],
      ["😀".repeat(10001), false],
    ] as const;
    for (const [value, expected] of samples) {
      const sample = createComplianceExample("JP");
      sample.config.business.name = value;
      sample.order.id = value;
      const fixture = {
        name: value,
        order: createComplianceExample("JP").order,
        expected: sample.expected,
      };
      expect(configValid(sample.config), `business name: ${value.length}`).toBe(
        expected,
      );
      expect(accepts(() => validateComplianceConfig(sample.config))).toBe(
        expected,
      );
      expect(orderValid(sample.order), `order ID: ${value.length}`).toBe(
        expected,
      );
      expect(accepts(() => validateOrder(sample.order, 0))).toBe(expected);
      expect(casesValid([fixture]), `case name: ${value.length}`).toBe(
        expected,
      );
      expect(
        accepts(() =>
          checkFinancialCases(createComplianceExample("JP").config, [fixture], {
            scope: "quotes",
          }),
        ),
      ).toBe(expected);
    }
  });

  it("matches unsigned decimal syntax, effective precision, magnitude, and raw length", () => {
    const samples = [
      ["0", true],
      ["001.00", true],
      ["0.000000000000000001", true],
      ["999999999999999999999999999999", true],
      [`1.${"0".repeat(1022)}`, true],
      ["+1", false],
      ["-0", false],
      ["-1", false],
      ["1e2", false],
      [".1", false],
      ["1.", false],
      [" 1", false],
      ["NaN", false],
      ["0.0000000000000000001", false],
      ["1000000000000000000000000000000", false],
      [`1.${"0".repeat(1023)}`, false],
    ] as const;
    for (const [value, expected] of samples) {
      const sample = createMeteredComplianceExample("US");
      const billing = sample.config.billing;
      if (!billing) throw Error("Metered examples require a billing policy.");
      billing.quantityPrecision = 18;
      billing.unitPricePrecision = 18;
      sample.config.products[0]!.unitPrice = value;
      sample.order.discount = value;
      expect(
        configValid(sample.config),
        `unitPrice: ${value.slice(0, 40)}`,
      ).toBe(expected);
      expect(accepts(() => validateComplianceConfig(sample.config))).toBe(
        expected,
      );
      expect(orderValid(sample.order), `discount: ${value.slice(0, 40)}`).toBe(
        expected,
      );
      expect(
        accepts(() => validateOrder(sample.order, 18, sample.config.billing)),
      ).toBe(expected);

      const { config, order, expected: totals } = createComplianceExample("US");
      config.billing = billing;
      const fixture = {
        name: "amount fixture",
        order,
        expected: { ...totals, net: value },
      };
      expect(casesValid([fixture]), `expected net: ${value.slice(0, 40)}`).toBe(
        expected,
      );
      // The fixture API validates expected money using the configured currency.
      // Values beyond USD precision remain a documented runtime context check.
      const usdPrecision =
        !value.includes(".") || /^\d+\.\d{1,2}0*$/.test(value);
      expect(
        accepts(() =>
          checkFinancialCases(config, [fixture], { scope: "quotes" }),
        ),
      ).toBe(expected && usdPrecision);
    }
  });

  it("matches reviewed decimal quantity bounds and numeric integer quantities", () => {
    const samples = [
      [1, true],
      [1000000, true],
      [0, false],
      [1000001, false],
      [0.3, false],
      ["0.000000000000000001", true],
      ["0001.000000000000000000000", true],
      ["1000000.000", true],
      ["1000000.1", false],
      ["0000.000", false],
      ["+1", false],
      ["-1", false],
      ["0.0000000000000000001", false],
      [`1.${"0".repeat(1023)}`, false],
    ] as const;
    for (const [value, expected] of samples) {
      const { config, order } = createMeteredComplianceExample("US");
      config.billing!.quantityPrecision = 18;
      order.lines[0]!.quantity = value;
      expect(orderValid(order), `quantity: ${String(value).slice(0, 40)}`).toBe(
        expected,
      );
      expect(accepts(() => validateOrder(order, 2, config.billing))).toBe(
        expected,
      );
    }
  });

  it("matches tax-rate bounds and requires zero plus a reason for other treatments", () => {
    const samples = [
      ["0.000000000000000001", true],
      ["099.999999999999999999", true],
      ["100.000", true],
      ["100.1", false],
      ["+10", false],
      ["-10", false],
      ["10e0", false],
      ["0", false],
      ["0.0000000000000000001", false],
      [`10.${"0".repeat(1022)}`, false],
    ] as const;
    for (const [rate, expected] of samples) {
      const { config } = createComplianceExample("US");
      config.rules.treatments[0]!.rate = rate;
      expect(configValid(config), `rate: ${rate.slice(0, 40)}`).toBe(expected);
      expect(accepts(() => validateComplianceConfig(config))).toBe(expected);
    }
    for (const treatment of ["zero-rated", "exempt", "out-of-scope"] as const) {
      const { config } = createComplianceExample("US");
      config.rules.treatments[0]!.treatment = treatment;
      config.rules.treatments[0]!.rate = "000.000";
      expect(configValid(config)).toBe(false);
      expect(accepts(() => validateComplianceConfig(config))).toBe(false);
      config.rules.treatments[0]!.reason = "Reviewed zero treatment";
      expect(configValid(config)).toBe(true);
      expect(accepts(() => validateComplianceConfig(config))).toBe(true);
    }
  });

  it("validates calendar dates and the new explicit review applicability fields", () => {
    for (const [date, expected] of [
      ["2028-02-29", true],
      ["2026-02-29", false],
      ["2026-13-01", false],
      ["2026-10-8", false],
      ["2026-10-08T00:00:00Z", false],
    ] as const) {
      const sample = createComplianceExample("JP");
      sample.order.date = date;
      expect(orderValid(sample.order)).toBe(expected);
      expect(accepts(() => validateOrder(sample.order, 0))).toBe(expected);
      sample.config.business.review!.appliesFrom = date;
      sample.config.business.review!.after = "2030-01-01";
      sample.config.rules.requirements[0]!.reviewAppliesFrom = date;
      sample.config.rules.requirements[0]!.reviewAfter = "2030-01-01";
      expect(configValid(sample.config)).toBe(expected);
      expect(accepts(() => validateComplianceConfig(sample.config))).toBe(
        expected,
      );
    }
  });

  it("uses real calendar dates for external registration verification", () => {
    for (const [date, expected] of [
      ["2026-10-08", true],
      ["2026-02-29", false],
      ["today", false],
    ] as const) {
      const {
        config,
        order,
        details,
        expected: totals,
      } = createComplianceExample("IN");
      details.externalRegistration = {
        irn: "a".repeat(64),
        signedQR: "Verified QR",
        evidence: "Registry evidence",
        verifiedBy: "Reviewer",
        verifiedOn: date,
      };
      const fixture = {
        name: "registration",
        order,
        details,
        expected: totals,
      };
      expect(casesValid([fixture])).toBe(expected);
      expect(
        createInvoiceDraft(config, order, details).status === "ready",
      ).toBe(expected);
    }
  });

  it("allows deliberately malformed inputs only when the fixture expects invalid", () => {
    const { config, order, details, expected } = createComplianceExample("JP");
    const fixtures = [
      { name: "ready", order, details, expected },
      {
        name: "missing buyer",
        order: { ...order, buyer: null },
        expected: { status: "invalid", issueCodes: ["INVALID-INPUT"] },
      },
      {
        name: "malformed invoice date",
        order,
        details: { ...details, issuedOn: "tomorrow" },
        expected: { status: "invalid", issueCodes: ["INVALID-INVOICE"] },
      },
    ];
    expect(casesValid(fixtures), JSON.stringify(casesValid.errors)).toBe(true);
    expect(checkFinancialCases(config, fixtures).exitCode).toBe(0);
    const wrongExpected = fixtures.map((fixture) => ({ ...fixture, expected }));
    expect(casesValid(wrongExpected)).toBe(false);
    expect(casesValid([{ ...fixtures[1], name: " " }])).toBe(false);
    expect(
      casesValid([
        { ...fixtures[1], expected: { status: "invalid", issueCodes: [" "] } },
      ]),
    ).toBe(false);
  });

  it("keeps contextual constraints explicit rather than treating schema success as readiness", () => {
    const sample = createComplianceExample("JP");
    sample.config.products[0]!.unitPrice = "0.01";
    expect(configValid(sample.config)).toBe(true);
    expect(() => validateComplianceConfig(sample.config)).toThrow(
      "decimal places",
    );

    sample.order.lines[0]!.quantity = "0.5";
    expect(orderValid(sample.order)).toBe(true);
    expect(() => validateOrder(sample.order, 0)).toThrow("billing policy");

    sample.order.lines[0]!.quantity = 1;
    sample.order.lines.push({ ...sample.order.lines[0]! });
    expect(orderValid(sample.order)).toBe(true);
    expect(() => validateOrder(sample.order, 0)).toThrow("unique");

    const example = createComplianceExample("JP");
    example.config.business.review!.after = example.config.business.review!.on;
    expect(configValid(example.config)).toBe(true);
    expect(() => validateComplianceConfig(example.config)).toThrow("follow");
  });
});
