// Immutable replay data. Add a new profile/version when wording, sources or currencies change.
// Existing entries are financial snapshot contracts and must never follow current metadata.
import { freeze } from "../internal";
import type { Requirement } from "./types";
import type { CountryCode, CurrencyCode } from "../countries";
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
const profileRequirements: readonly Requirement[] = freeze([
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

export const ORDER_PROFILE_ID = "glocon-ordinary-domestic-1" as const;
export const ORDER_PROFILE_1 = freeze({
  id: ORDER_PROFILE_ID,
  requirements: profileRequirements,
  countries: {
    IN: { code: "IN", currency: "INR", digits: 2 },
    JP: { code: "JP", currency: "JPY", digits: 0 },
    US: { code: "US", currency: "USD", digits: 2 },
  } satisfies Record<
    CountryCode,
    { code: CountryCode; currency: CurrencyCode; digits: number }
  >,
});
export const ORDER_LIMITATIONS_1 = freeze([
  "Reviewed transaction inputs are supplied by the business; registration, product classification and jurisdiction are not determined automatically.",
  "Line tax amounts are allocations of rate-group totals, not independently rounded tax amounts.",
  "This result is a calculation, not government registration, a tax return or compliance certification.",
]);
