import type { CountryCode, CurrencyCode } from "../countries";
import type { RoundingMode } from "../internal";
export interface Review {
  by: string;
  on: string;
  after: string;
  reference: string;
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
}
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
    quantity: number;
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
  quantity: number;
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
  engine: "glocon-order-1";
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
  lines: { lineId: string; quantity: number }[];
}
export interface CreditLine {
  lineId: string;
  quantity: number;
  net: string;
  tax: string;
  gross: string;
  rate: string;
}
export interface CreditNoteDraft {
  kind: "credit-note";
  version: 1;
  status: "draft";
  originalDigest: string;
  originalNumber: string;
  originalDate: string;
  request: CreditRequest;
  previousDigests: string[];
  lines: CreditLine[];
  net: string;
  tax: string;
  gross: string;
  digest: string;
  /** Financial allocation only; full statutory credit-note issuance is a separate validation. */
  legalStatus: "review-required";
}
export interface TaxProvider {
  id: string;
  resolve(
    productId: string,
    jurisdiction: string,
    date: string,
  ): Result<TreatmentRule>;
}
