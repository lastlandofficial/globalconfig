// Local demo only: authorize customers, validate trusted addresses and use reviewed production config in your app.
// Node.js 22.13+ supplies node:sqlite. Do not deploy this unauthenticated fixture as a public API.
import { DatabaseSync } from "node:sqlite";
import { createComplianceExample, calculateOrder } from "glocon/compliance";
import { createSQLiteInvoiceStore } from "glocon/compliance/server";
export function createDemoService(file = "glocon-demo.sqlite") {
  const db = new DatabaseSync(file),
    store = createSQLiteInvoiceStore(db);
  const { config, order } = createComplianceExample("JP");
  return {
    close() {
      db.close();
    },
    execute(input) {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (k) => !["operation", "key", "originalNumber"].includes(k),
        ) ||
        !["quote", "invoice", "credit"].includes(input.operation)
      )
        throw Error("Invalid request; totals and prices are server-owned.");
      if (
        typeof input.key !== "string" ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(input.key)
      )
        throw Error("Supply a request key.");
      const transaction = { ...order, id: input.key };
      if (input.operation === "quote") {
        const result = calculateOrder(config, transaction);
        if (result.status !== "ready") throw Error("Review required.");
        return {
          message: "Quote ready",
          net: result.value.net,
          tax: result.value.tax,
          total: result.value.gross,
        };
      }
      if (input.operation === "invoice") {
        const invoice = store.issue({
          key: `invoice-${input.key}`,
          config,
          order: transaction,
          details: { issuedOn: order.date },
        });
        return {
          message: "Invoice recorded",
          number: invoice.number,
          total: invoice.document.calculation.gross,
        };
      }
      if (typeof input.originalNumber !== "string")
        throw Error("Choose an original invoice.");
      const credit = store.credit({
        business: config.business.id,
        originalNumber: input.originalNumber,
        key: `credit-${input.key}`,
        request: {
          date: order.date,
          reason: "Demo partial return",
          review: config.business.review,
          lines: [{ lineId: "item-1", quantity: 1 }],
        },
      });
      return {
        message: "Credit recorded",
        number: credit.number,
        total: credit.document.gross,
      };
    },
  };
}
