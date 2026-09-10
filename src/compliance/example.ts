import type { CountryCode } from "../countries";
import { requirements, copy } from "./rules";
import type { ComplianceConfig, InvoiceDetails, Order, Review } from "./types";
/** Explicit fictional data for learning/testing, never a product-classification recommendation. */
export function createComplianceExample(
  country: CountryCode = "JP",
  date = "2026-09-09",
) {
  const year = Number(date.slice(0, 4));
  const reviewed: Review = {
    by: "Example reviewer (fictional)",
    on: date,
    after: `${year + 1}-01-01`,
    reference:
      "TEST DATA ONLY: replace with an actual reviewed business decision",
  };
  const ruleRequirements = copy(
    requirements.filter((r) => r.country === country),
  );
  const config: ComplianceConfig = {
    version: 1,
    business: {
      id: "example-business",
      name: "Example business (test)",
      address: "Example address — fictional",
      country,
      environment: "test",
      registration: "registered",
      registrationId:
        country === "JP"
          ? "T1234567890123"
          : country === "IN"
            ? "27AAAAA0000A1Z5"
            : "TEST-PERMIT",
      invoiceSeries: "INV",
      review: reviewed,
      ...(country === "IN"
        ? {
            stateCode: "27",
            india: {
              eInvoice: "not-required" as const,
              signature: "electronic-exception" as const,
            },
          }
        : {}),
    },
    products: [
      {
        id: "example-item",
        description: "Example item — replace classification",
        unitPrice: country === "JP" ? "1000" : "100.00",
        classification: country === "IN" ? "0000" : "TEST",
        unit: "each",
      },
    ],
    rules: {
      version: 1,
      revision: "example-1",
      requirements: ruleRequirements,
      treatments: [
        {
          id: "example-treatment",
          productId: "example-item",
          jurisdiction: country === "US" ? "US-CA/EXAMPLE" : country,
          treatment: "taxable",
          rate: country === "JP" ? "10" : country === "IN" ? "18" : "7.25",
          effectiveFrom: date,
          review: reviewed,
        },
      ],
    },
    rounding: "half-up",
  };
  const order: Order = {
    id: "example-order",
    date,
    jurisdiction: country === "US" ? "US-CA/EXAMPLE" : country,
    buyer: {
      name: "Example buyer",
      country,
      address: "Example buyer address",
      stateCode: country === "IN" ? "27" : "EXAMPLE",
    },
    scenario: "ordinary-domestic",
    lines: [{ id: "item-1", productId: "example-item", quantity: 2 }],
    pricing: "exclusive",
    ...(country === "IN"
      ? {
          supply: "intra-state" as const,
          localTax: "SGST" as const,
          placeOfSupply: "Maharashtra (27)",
        }
      : {}),
  };
  const details: InvoiceDetails = { number: `INV/${year}/1`, issuedOn: date };
  return { config, order, details };
}
