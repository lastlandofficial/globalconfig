import {
  calculateOrder,
  createComplianceExample,
  createInvoiceDraft,
  createCreditNoteDraft,
} from "../src/compliance";
const { config, order, details } = createComplianceExample("JP");
const quote = calculateOrder(config, order);
const invoice = createInvoiceDraft(config, order, details);
if (quote.status !== "ready" || invoice.status !== "ready")
  throw Error("Browser financial calculation failed");
const credit = createCreditNoteDraft(invoice.value, {
  number: "C1",
  date: order.date,
  reason: "Browser fixture",
  review: config.business.review!,
  lines: [{ lineId: "item-1", quantity: 1 }],
});
if (credit.status !== "ready") throw Error("Browser credit failed");
document.querySelector("#result")!.textContent = JSON.stringify({
  gross: quote.value.gross,
  credit: credit.value.gross,
});

const metered = createComplianceExample("JP");
metered.config.billing = {
  quantityPrecision: 6,
  unitPricePrecision: 6,
  lineRounding: "half-up",
  review: metered.config.business.review!,
};
metered.config.products[0]!.unitPrice = "50";
metered.order.lines[0]!.quantity = "0.3";
const meteredInvoice = createInvoiceDraft(
  metered.config,
  metered.order,
  metered.details,
);
if (meteredInvoice.status !== "ready")
  throw Error("Browser metered invoice failed");
const history: import("../src/compliance").CreditNoteDraft[] = [];
for (const number of ["M1", "M2", "M3"]) {
  const result = createCreditNoteDraft(
    meteredInvoice.value,
    {
      number,
      date: metered.order.date,
      reason: "Metered browser fixture",
      review: metered.config.business.review!,
      lines: [{ lineId: "item-1", quantity: "0.1" }],
    },
    history,
  );
  if (result.status !== "ready") throw Error("Browser metered credit failed");
  history.push(result.value);
}
document.querySelector("#metered-result")!.textContent = JSON.stringify({
  engine: meteredInvoice.value.calculation.engine,
  gross: meteredInvoice.value.calculation.gross,
  credits: history.map((c) => c.gross),
});
