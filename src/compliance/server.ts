import { calculateOrder } from "./engine";
import { createInvoiceDraft, createCreditNoteDraft } from "./invoice";
import { copy, digest } from "./rules";
import type {
  ComplianceConfig,
  Order,
  InvoiceDetails,
  InvoiceDraft,
  CreditRequest,
  CreditNoteDraft,
} from "./types";
/** Compatible with node:sqlite DatabaseSync and synchronous SQLite drivers. */
export interface SQLiteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: any[]): unknown;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  };
}
export interface StoredInvoice {
  type: "invoice";
  number: string;
  document: InvoiceDraft;
}
export interface StoredCredit {
  type: "financial-credit";
  number: string;
  document: CreditNoteDraft;
}
/** Own the connection during a synchronous transaction. Authorize requests before calling this service. */
export function createSQLiteInvoiceStore(db: SQLiteDatabase) {
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS glocon_documents (number TEXT PRIMARY KEY, business TEXT NOT NULL, kind TEXT NOT NULL, original TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS glocon_requests (business TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(business,request_key));
CREATE TABLE IF NOT EXISTS glocon_sequences (business TEXT NOT NULL, series TEXT NOT NULL, period TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(business,series,period));`);
  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const idempotent = <T>(
    business: string,
    key: string,
    input: unknown,
    fn: () => T,
  ): T =>
    transaction(() => {
      if (typeof key !== "string" || !key.trim() || key.length > 200)
        throw Error("Provide an idempotency key up to 200 characters.");
      const fingerprint = digest(input),
        previous = db
          .prepare(
            "SELECT fingerprint,result FROM glocon_requests WHERE business=? AND request_key=?",
          )
          .get(business, key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw Error("Idempotency key was already used for different input.");
        return JSON.parse(previous.result) as T;
      }
      const result = fn();
      db.prepare("INSERT INTO glocon_requests VALUES(?,?,?,?)").run(
        business,
        key,
        fingerprint,
        JSON.stringify(result),
      );
      return result;
    });
  const next = (
    business: string,
    series: string,
    date: string,
    country: string,
  ) => {
    const year =
      Number(date.slice(0, 4)) -
      (country === "IN" && Number(date.slice(5, 7)) < 4 ? 1 : 0);
    const period = String(year);
    db.prepare(
      "INSERT INTO glocon_sequences VALUES(?,?,?,0) ON CONFLICT DO NOTHING",
    ).run(business, series, period);
    db.prepare(
      "UPDATE glocon_sequences SET value=value+1 WHERE business=? AND series=? AND period=?",
    ).run(business, series, period);
    const { value } = db
      .prepare(
        "SELECT value FROM glocon_sequences WHERE business=? AND series=? AND period=?",
      )
      .get(business, series, period);
    const number = `${series}/${period}/${value}`;
    if (number.length > 16)
      throw Error("Invoice sequence exhausted its 16-character number space.");
    return number;
  };
  return Object.freeze({
    /** Records a validated invoice snapshot; external signatures/IRP are caller-verified evidence. */
    issue(input: {
      key: string;
      config: ComplianceConfig;
      order: Order;
      details: Omit<InvoiceDetails, "number">;
    }): StoredInvoice {
      // Recalculate from server-owned prices and treatments; never accept client totals.
      const calculated = calculateOrder(input.config, input.order);
      if (calculated.status !== "ready")
        throw Error(JSON.stringify(calculated));
      const b = input.config.business;
      return idempotent(
        b.id,
        input.key,
        {
          kind: "invoice",
          config: input.config,
          order: input.order,
          details: input.details,
        },
        () => {
          const number = next(
            b.id,
            b.invoiceSeries,
            input.details.issuedOn,
            b.country,
          );
          const result = createInvoiceDraft(input.config, input.order, {
            ...input.details,
            number,
          });
          if (result.status !== "ready") throw Error(JSON.stringify(result));
          const stored: StoredInvoice = {
            type: "invoice",
            number,
            document: result.value,
          };
          db.prepare("INSERT INTO glocon_documents VALUES(?,?,?,?,?)").run(
            `${b.id}:${number}`,
            b.id,
            "invoice",
            null,
            JSON.stringify(stored),
          );
          return copy(stored);
        },
      );
    },
    get(
      business: string,
      number: string,
    ): StoredInvoice | StoredCredit | undefined {
      const row = db
        .prepare(
          "SELECT data FROM glocon_documents WHERE business=? AND number=?",
        )
        .get(business, `${business}:${number}`);
      return row ? JSON.parse(row.data) : undefined;
    },
    /** Financial credit record. Statutory credit-note rendering/filing still requires jurisdiction review. */
    credit(input: {
      business: string;
      originalNumber: string;
      key: string;
      request: Omit<CreditRequest, "number">;
    }): StoredCredit {
      return idempotent(
        input.business,
        input.key,
        {
          kind: "credit",
          originalNumber: input.originalNumber,
          request: input.request,
        },
        () => {
          const row = db
            .prepare(
              "SELECT data FROM glocon_documents WHERE business=? AND number=? AND kind='invoice'",
            )
            .get(input.business, `${input.business}:${input.originalNumber}`);
          if (!row)
            throw Error("Original invoice not found for this business.");
          const original = (JSON.parse(row.data) as StoredInvoice).document;
          const history = db
            .prepare(
              "SELECT data FROM glocon_documents WHERE business=? AND original=? AND kind='financial-credit' ORDER BY rowid",
            )
            .all(input.business, input.originalNumber)
            .map((row) => (JSON.parse(row.data) as StoredCredit).document);
          const b = original.calculation.snapshot.config.business;
          const series = `C${b.invoiceSeries}`;
          const number = next(b.id, series, input.request.date, b.country);
          const result = createCreditNoteDraft(
            original,
            { ...input.request, number },
            history,
          );
          if (result.status !== "ready") throw Error(JSON.stringify(result));
          const stored: StoredCredit = {
            type: "financial-credit",
            number,
            document: result.value,
          };
          db.prepare("INSERT INTO glocon_documents VALUES(?,?,?,?,?)").run(
            `${b.id}:${number}`,
            b.id,
            "financial-credit",
            input.originalNumber,
            JSON.stringify(stored),
          );
          return copy(stored);
        },
      );
    },
  });
}
