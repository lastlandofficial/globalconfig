import { D } from "./internal";

let checkedConstructor: typeof Intl.NumberFormat | undefined;
let exactDecimalStrings = false;
function supportsExactStrings() {
  if (checkedConstructor !== Intl.NumberFormat) {
    checkedConstructor = Intl.NumberFormat;
    exactDecimalStrings =
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format("9007199254740993.01" as unknown as number) ===
      "9,007,199,254,740,993.01";
  }
  return exactDecimalStrings;
}

/** Keep exact digits when an older Intl implementation coerces decimal strings to doubles. */
export function formatExactCurrency(
  fixed: string,
  formatter: Intl.NumberFormat,
  locale: string,
  display: string | undefined,
) {
  if (supportsExactStrings())
    return formatter.format(fixed as unknown as number);
  const approximate = Number(fixed);
  if (display === "name") {
    // Currency-name grammar can depend on the exact value. Never select it from a lossy approximation.
    if (Math.abs(approximate) >= 2 ** 45 || !new D(approximate).eq(fixed))
      throw new RangeError(
        "Exact currency-name formatting requires decimal-string Intl support for this amount. Use symbol/code or install a compatible Intl implementation.",
      );
    return formatter.format(approximate);
  }
  if (typeof formatter.formatToParts !== "function")
    throw new TypeError(
      "Exact currency formatting requires Intl.NumberFormat.formatToParts on this runtime.",
    );
  const digitFormatter = new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 0,
  });
  const digitMap = Array.from({ length: 10 }, (_, digit) =>
    digitFormatter.format(digit),
  );
  const localize = (value: string) =>
    [...value].map((digit) => digitMap[Number(digit)]).join("");
  // This integer is below Number.MAX_SAFE_INTEGER. Probe grouping without exposing the amount to a double.
  const probe = formatter.formatToParts(123456789012345);
  const separator = probe.find((part) => part.type === "group")?.value;
  const groups = probe
    .filter((part) => part.type === "integer")
    .map((part) => [...part.value].length);
  const [integer, fraction = ""] = fixed.replace(/^-/, "").split(".");
  let grouped = localize(integer!);
  if (separator && groups.length > 1) {
    let minimum = 1;
    while (
      minimum < 15 &&
      !formatter
        .formatToParts(10 ** (minimum - 1))
        .some((part) => part.type === "group")
    )
      minimum++;
    if (integer!.length >= minimum) {
      const primary = groups[groups.length - 1]!;
      const secondary = groups[groups.length - 2]!;
      const chunks: string[] = [];
      let end = integer!.length;
      let size = primary;
      while (end > 0) {
        const start = Math.max(0, end - size);
        chunks.unshift(localize(integer!.slice(start, end)));
        end = start;
        size = secondary;
      }
      grouped = chunks.join(separator);
    }
  }
  const decimal = probe.find((part) => part.type === "decimal")?.value;
  if (fraction && decimal === undefined)
    throw new TypeError("Intl did not expose the currency decimal separator.");
  const numeric = grouped + (fraction ? decimal + localize(fraction) : "");
  let inserted = false;
  return formatter
    .formatToParts(approximate)
    .map((part) => {
      if (part.type === "integer") {
        if (inserted) return "";
        inserted = true;
        return numeric;
      }
      if (["group", "decimal", "fraction"].includes(part.type)) return "";
      return part.value;
    })
    .join("");
}
