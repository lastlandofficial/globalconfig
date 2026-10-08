import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createComplianceExample } from "../dist/compliance/index.js";
import { createSQLiteInvoiceStore } from "../dist/compliance/server.js";
let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}
test(
  "SQLite numbering, retry protection, restart persistence and credit limits",
  { skip: !DatabaseSync },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "glocon-invoices-"));
    const file = join(dir, "invoices.sqlite");
    let db = new DatabaseSync(file);
    try {
      const store = createSQLiteInvoiceStore(db),
        { config, order, details } = createComplianceExample("JP");
      const input = {
        key: "order1",
        config,
        order,
        details: { issuedOn: details.issuedOn },
      };
      const a = store.issue(input);
      assert.deepEqual(store.issue(input), a);
      assert.equal(a.number, "INV/2026/1");
      assert.throws(
        () => store.issue({ ...input, order: { ...order, id: "different" } }),
        /Idempotency/,
      );
      const request = {
        date: order.date,
        reason: "Return",
        review: config.business.review,
        lines: [{ lineId: "item-1", quantity: 1 }],
      };
      const first = store.credit({
        business: config.business.id,
        originalNumber: a.number,
        key: "credit1",
        request,
      });
      assert.equal(first.document.gross, "1100");
      db.close();
      db = new DatabaseSync(file);
      const restored = createSQLiteInvoiceStore(db);
      assert.deepEqual(restored.get(config.business.id, a.number), a);
      const second = restored.credit({
        business: config.business.id,
        originalNumber: a.number,
        key: "credit2",
        request,
      });
      assert.equal(second.document.gross, "1100");
      assert.throws(
        () =>
          restored.credit({
            business: config.business.id,
            originalNumber: a.number,
            key: "credit3",
            request,
          }),
        /remaining/,
      );
      assert.equal(
        restored.issue({ ...input, key: "order2" }).number,
        "INV/2026/2",
      );
      assert.equal(restored.get("other-business", a.number), undefined);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test(
  "independent SQLite connections cannot refund the same remaining quantity twice",
  { skip: !DatabaseSync },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "glocon-concurrency-"));
    const file = join(dir, "invoices.sqlite");
    const db = new DatabaseSync(file);
    try {
      const { config, order, details } = createComplianceExample("JP");
      order.lines[0].quantity = 1;
      const original = createSQLiteInvoiceStore(db).issue({
        key: "order",
        config,
        order,
        details: { issuedOn: details.issuedOn },
      });
      const input = {
        business: config.business.id,
        originalNumber: original.number,
        request: {
          date: order.date,
          reason: "Return",
          review: config.business.review,
          lines: [{ lineId: "item-1", quantity: 1 }],
        },
      };
      const source = `const {parentPort,workerData}=require('node:worker_threads'); (async()=>{const {DatabaseSync}=await import('node:sqlite');const {createSQLiteInvoiceStore}=await import(workerData.module);const db=new DatabaseSync(workerData.file);try{createSQLiteInvoiceStore(db).credit(workerData.input);parentPort.postMessage('recorded');}catch(e){parentPort.postMessage(String(e.message));}finally{db.close();}})();`;
      const run = (key) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(source, {
            eval: true,
            workerData: {
              file,
              module: new URL("../dist/compliance/server.js", import.meta.url)
                .href,
              input: { ...input, key },
            },
          });
          worker.once("message", resolve);
          worker.once("error", reject);
        });
      const results = await Promise.all([run("credit-a"), run("credit-b")]);
      assert.equal(results.filter((r) => r === "recorded").length, 1);
      assert.ok(results.some((r) => r.includes("remaining")));
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "fractional SQLite credits remain exact across retry, restart and competing connections",
  { skip: !DatabaseSync },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "glocon-fractional-store-"));
    const file = join(dir, "invoices.sqlite");
    let db = new DatabaseSync(file);
    try {
      const { config, order, details } = createComplianceExample("JP");
      config.billing = {
        quantityPrecision: 6,
        unitPricePrecision: 6,
        lineRounding: "half-up",
        review: config.business.review,
      };
      config.products[0].unitPrice = "50";
      order.lines[0].quantity = "0.3";
      const input = {
        key: "metered-order",
        config,
        order,
        details: { issuedOn: details.issuedOn },
      };
      const original = createSQLiteInvoiceStore(db).issue(input);
      assert.equal(original.document.calculation.engine, "glocon-order-2");
      assert.equal(original.document.calculation.gross, "17");
      assert.deepEqual(createSQLiteInvoiceStore(db).issue(input), original);
      const credit = {
        business: config.business.id,
        originalNumber: original.number,
        request: {
          date: order.date,
          reason: "Reviewed fractional return",
          review: config.business.review,
          lines: [{ lineId: "item-1", quantity: "0.2" }],
        },
      };
      const workerSource = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {DatabaseSync}=await import('node:sqlite');const {createSQLiteInvoiceStore}=await import(workerData.module);const db=new DatabaseSync(workerData.file);try{parentPort.postMessage({ok:true,result:createSQLiteInvoiceStore(db).credit(workerData.input)});}catch(e){parentPort.postMessage({ok:false,message:e.message});}finally{db.close();}})();`;
      const run = (key) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(workerSource, {
            eval: true,
            workerData: {
              file,
              module: new URL("../dist/compliance/server.js", import.meta.url)
                .href,
              input: { ...credit, key },
            },
          });
          worker.once("message", resolve);
          worker.once("error", reject);
        });
      const results = await Promise.all([run("credit-a"), run("credit-b")]);
      const completed = results.filter((r) => r.ok);
      assert.equal(completed.length, 1);
      assert.ok(results.some((r) => !r.ok && r.message.includes("remaining")));
      const first = completed[0].result;
      assert.equal(first.document.gross, "11");
      db.close();
      db = new DatabaseSync(file);
      const store = createSQLiteInvoiceStore(db);
      assert.deepEqual(
        store.get(config.business.id, original.number),
        original,
      );
      const finalRequest = {
        ...credit,
        key: "credit-final",
        request: {
          ...credit.request,
          lines: [{ lineId: "item-1", quantity: "0.1" }],
        },
      };
      const last = store.credit(finalRequest);
      assert.equal(last.document.gross, "6");
      assert.deepEqual(store.credit(finalRequest), last);
      assert.equal(
        BigInt(first.document.gross) + BigInt(last.document.gross),
        BigInt(original.document.calculation.gross),
      );
      assert.throws(
        () => store.credit({ ...finalRequest, key: "credit-extra" }),
        /remaining/,
      );
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
