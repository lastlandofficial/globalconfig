import {
  calculateOrder,
  createMeteredComplianceExample,
} from "glocon/compliance";
import { formatCurrency, toMinorUnits, fromMinorUnits } from "glocon/currency";
import { convertLocalTime } from "glocon/time";

const example = createMeteredComplianceExample("JP");
const quote = calculateOrder(example.config, example.order);
if (quote.status !== "ready") throw Error(JSON.stringify(quote));
const browser = {
  engine: quote.value.engine,
  gross: quote.value.gross,
  formatted: formatCurrency("9007199254740993.01", "USD"),
  roundtrip: fromMinorUnits(
    toMinorUnits("999999999999999999999999999999.99", "USD"),
    "USD",
  ),
  time: convertLocalTime("2026-11-01T01:30", {
    from: "America/New_York",
    to: "UTC",
    disambiguation: "later",
  }).instant,
  requireType: typeof globalThis.require,
};
document.querySelector("#browser-result").textContent = JSON.stringify(browser);
const buttons = [...document.querySelectorAll("button")];
const status = document.querySelector("#status");
const retry = document.querySelector("#retry");
let previous;
async function run(action) {
  previous = action;
  retry.hidden = true;
  buttons.forEach((button) => {
    button.disabled = true;
  });
  status.textContent = "Working…";
  try {
    const value = await window.fixtureFinance.run(action);
    document.querySelector("#total").textContent =
      value.type === "invoice"
        ? value.document.calculation.gross
        : value.document.gross;
    status.textContent =
      value.type === "invoice" ? "Invoice recorded" : "Credit recorded";
  } catch {
    status.textContent = "Service unavailable. Retry the request.";
    retry.hidden = false;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
for (const id of ["issue", "first-credit", "final-credit"]) {
  document.querySelector(`#${id}`).addEventListener("click", () => run(id));
}
retry.addEventListener("click", () => run(previous));
