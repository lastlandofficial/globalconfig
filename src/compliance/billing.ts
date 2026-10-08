import { D, decimal } from "../internal";
import type { BillingPolicy, ComplianceConfig, Quantity } from "./types";

export function calculationEngine(config: Pick<ComplianceConfig, "billing">) {
  return config.billing
    ? ("glocon-order-2" as const)
    : ("glocon-order-1" as const);
}

/** Converts quantities to exact integer units; no binary floating-point accumulation. */
export function quantityUnits(value: unknown, policy?: BillingPolicy): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw Error(
        "Fractional quantities must be plain decimal strings, not floating-point numbers.",
      );
  } else if (
    typeof value !== "string" ||
    !policy ||
    !/^\d+(?:\.\d+)?$/.test(value)
  ) {
    throw Error(
      "Quantity must be a positive integer, or a plain decimal string under a reviewed billing policy.",
    );
  }
  const amount = decimal(value as Quantity, "Quantity");
  const precision = policy?.quantityPrecision ?? 0;
  if (!amount.gt(0) || amount.gt(1000000) || amount.decimalPlaces() > precision)
    throw Error(
      `Quantity must be positive, no greater than 1000000 and have at most ${precision} decimal places.`,
    );
  return BigInt(amount.mul(new D(10).pow(precision)).toFixed(0));
}
