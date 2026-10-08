import type { CountryCode, CurrencyCode } from "../countries";
import type { RoundingMode } from "../internal";
import type { IndiaRoundingPolicy } from "../tax-rounding";
export interface Review {
  by: string;
  on: string;
  after: string;
  reference: string;
  /** First transaction date covered by this review; defaults to the date the review occurred. */
  appliesFrom?: string;
}
export interface BusinessProfile {
  id: string;
  name: string;
  address: string;
  country: CountryCode;
  environment: "test" | "production";
  registration: "registered" | "unregistered" | "unknown";
  registrationId?: string;
  stateCode?: string;
  review?: Review;
  invoiceSeries: string;
  /** India invoice-specific obligations, determined by the business. */
  india?: {
    eInvoice: "required" | "not-required" | "unknown";
    declaration?: string;
    signature: "required" | "electronic-exception" | "unknown";
  };
}
export type TaxTreatment = "taxable" | "zero-rated" | "exempt" | "out-of-scope";
export interface Product {
  id: string;
  description: string;
  unitPrice: string;
  classification?: string;
  unit?: string;
}
export interface TreatmentRule {
  id: string;
  productId: string;
  jurisdiction: string;
  treatment: TaxTreatment;
  rate: string;
  effectiveFrom: string;
  effectiveTo?: string;
  review: Review;
  /** Required for exemption/zero-rating/exclusion; does not imply invoice support. */
  reason?: string;
}
export interface Requirement {
  id: string;
  title: string;
  country: CountryCode;
  source: string;
  provision: string;
  reviewedOn: string;
  reviewAfter: string;
  /** First covered transaction date; defaults to reviewedOn. Allows explicit retrospective review. */
  reviewAppliesFrom?: string;
  scope: string;
}
export interface RulePack {
  version: 1;
  revision: string;
  requirements: Requirement[];
  treatments: TreatmentRule[];
}
export interface ComplianceConfig {
  $schema?: string;
  version: 1;
  business: BusinessProfile;
  products: Product[];
  rules: RulePack;
  rounding: RoundingMode;
  /** Defaults to components, matching calculateTax. Recorded in calculation snapshots when supplied. */
  indiaRounding?: IndiaRoundingPolicy;
  /** Explicit reviewed precision for metered/fractional billing; absence retains the original integer engine. */
  billing?: BillingPolicy;
}
export interface BillingPolicy {
  quantityPrecision: number;
  unitPricePrecision: number;
  lineRounding: RoundingMode;
  review: Review;
}
/** Whole quantities may be numbers; fractional quantities must use exact plain decimal strings. */
export type Quantity = number | string;
export interface Buyer {
  name: string;
  country: CountryCode;
  address?: string;
  registrationId?: string;
  stateCode?: string;
}
export interface Order {
  id: string;
  date: string;
  jurisdiction: string;
  buyer: Buyer;
  scenario:
    | "ordinary-domestic"
    | "cross-border"
    | "reverse-charge"
    | "marketplace"
    | "special";
  lines: {
    id: string;
    productId: string;
    quantity: Quantity;
    discount?: string;
  }[];
  discount?: string;
  pricing: "exclusive" | "inclusive";
  supply?: "intra-state" | "inter-state";
  localTax?: "SGST" | "UTGST";
  placeOfSupply?: string;
}
export interface ComplianceIssue {
  code: string;
  field: string;
  message: string;
  fix: string;
  source?: string;
}
export type Result<T> =
  | { status: "ready"; value: T }
  | {
      status: "needs-context" | "unsupported" | "invalid";
      issues: ComplianceIssue[];
    };
export interface CalculatedLine {
  id: string;
  productId: string;
  description: string;
  classification: string;
  unit: string;
  quantity: Quantity;
  unitPrice: string;
  discount: string;
  treatment: TaxTreatment;
  rate: string;
  ruleId: string;
  net: string;
  tax: string;
  gross: string;
}
export interface TaxGroup {
  treatment: TaxTreatment;
  rate: string;
  net: string;
  tax: string;
  gross: string;
  components: { name: string; rate: string; amount: string }[];
}
export interface Calculation {
  engine: "glocon-order-1" | "glocon-order-2" | "glocon-order-3";
  /** Required for engine 3; older engines implicitly use the original pinned profile. */
  profile?: "glocon-ordinary-domestic-1";
  currency: CurrencyCode;
  country: CountryCode;
  lines: CalculatedLine[];
  groups: TaxGroup[];
  net: string;
  tax: string;
  gross: string;
  discount: string;
  snapshot: { config: ComplianceConfig; order: Order };
  digest: string;
  limitations: string[];
}
export interface InvoiceDetails {
  number: string;
  issuedOn: string;
  signatureEvidence?: string;
  externalRegistration?: {
    irn: string;
    signedQR: string;
    evidence: string;
    verifiedBy: string;
    verifiedOn: string;
  };
}
export interface InvoiceDraft {
  kind: "invoice";
  version: 1;
  status: "draft";
  details: InvoiceDetails;
  calculation: Calculation;
  digest: string;
}
export interface CreditRequest {
  number: string;
  date: string;
  reason: string;
  review: Review;
  lines: { lineId: string; quantity: Quantity }[];
}
export interface CreditLine {
  lineId: string;
  quantity: Quantity;
  net: string;
  tax: string;
  gross: string;
  rate: string;
}
interface CreditNoteBase {
  kind: "credit-note";
  status: "draft";
  originalDigest: string;
  originalNumber: string;
  originalDate: string;
  request: CreditRequest;
  lines: CreditLine[];
  net: string;
  tax: string;
  gross: string;
  digest: string;
  /** Financial allocation only; full statutory credit-note issuance is a separate validation. */
  legalStatus: "review-required";
}
export interface CreditNoteDraftV1 extends CreditNoteBase {
  version: 1;
  previousDigests: string[];
}
export interface CreditNoteDraftV2 extends CreditNoteBase {
  version: 2;
  previousDigest: string | null;
  historyLength: number;
}
export type CreditNoteDraft = CreditNoteDraftV1 | CreditNoteDraftV2;
export interface CreditNoteOptions {
  version?: 1 | 2;
}
export interface TaxProvider {
  id: string;
  resolve(
    productId: string,
    jurisdiction: string,
    date: string,
  ): Result<TreatmentRule>;
}
