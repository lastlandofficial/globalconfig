import type { Decimal } from "decimal.js";
import { rounding, type RoundingMode } from "./internal";

/** components rounds each half separately; combined preserves the pre-0.7 aggregate policy. */
export type IndiaRoundingPolicy = "components" | "combined";

export function roundTax(
  raw: Decimal,
  digits: number,
  mode: RoundingMode = "half-up",
  intra = false,
  policy: IndiaRoundingPolicy = "components",
) {
  if (policy !== "components" && policy !== "combined")
    throw new RangeError("indiaRounding must be components or combined");
  const tax =
    intra && policy === "components"
      ? raw.div(2).toDecimalPlaces(digits, rounding(mode)).mul(2)
      : raw.toDecimalPlaces(digits, rounding(mode));
  const central = intra
    ? tax.div(2).toDecimalPlaces(digits, rounding(mode))
    : tax;
  return { tax, central, local: tax.minus(central) };
}
