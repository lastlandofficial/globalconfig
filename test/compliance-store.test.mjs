import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  createComplianceExample,
  createCreditNoteDraft,
  digest,
  replayCalculation,
} from "../dist/compliance/index.js";
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
  "persisted legacy idempotency results replay before stricter current validation",
  { skip: !DatabaseSync },
  async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../fixtures/compliance-v0.7.engine2.snapshots.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const invoice = structuredClone(
      fixture.snapshots.find((entry) => entry.country === "JP").invoice,
    );
    invoice.calculation.snapshot.order.lines[0].quantity = `0.3${"0".repeat(1100)}`;
    const replay = replayCalculation(invoice.calculation);
    assert.equal(replay.status, "ready");
    invoice.calculation = replay.value;
    invoice.details.number = "INV/2026/1";
    const { digest: _, ...invoiceBody } = invoice;
    invoice.digest = digest(invoiceBody);
    const input = {
      key: "legacy-padded-order",
      config: invoice.calculation.snapshot.config,
      order: invoice.calculation.snapshot.order,
      details: { issuedOn: invoice.details.issuedOn },
    };
    const saved = {
      type: "invoice",
      number: invoice.details.number,
      document: invoice,
    };
    const fingerprint = digest({
      kind: "invoice",
      config: input.config,
      order: input.order,
      details: input.details,
    });
    const db = new DatabaseSync(":memory:");
    try {
      const store = createSQLiteInvoiceStore(db);
      const business = input.config.business.id;
      db.prepare("INSERT INTO glocon_documents VALUES(?,?,?,?,?)").run(
        `${business}:${saved.number}`,
        business,
        "invoice",
        null,
        JSON.stringify(saved),
      );
      db.prepare("INSERT INTO glocon_requests VALUES(?,?,?,?)").run(
        business,
        input.key,
        fingerprint,
        JSON.stringify(saved),
      );
      db.prepare("INSERT INTO glocon_sequences VALUES(?,?,?,?)").run(
        business,
        "INV",
        "2026",
        1,
      );
      assert.deepEqual(store.issue(input), saved);
      assert.throws(
        () => store.issue({ ...input, key: "new-padded-order" }),
        /1024|length/,
      );
      assert.equal(
        db
          .prepare(
            "SELECT value FROM glocon_sequences WHERE business=? AND series=? AND period=?",
          )
          .get(business, "INV", "2026").value,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM glocon_requests").get().count,
        1,
      );
    } finally {
      db.close();
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
      assert.equal(original.document.calculation.engine, "glocon-order-3");
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

test(
  "SQLite installs a selective history index in existing databases and stores compact mixed-version histories",
  { skip: !DatabaseSync },
  () => {
    const db = new DatabaseSync(":memory:");
    try {
      // Simulate an existing pre-index installation rather than a fresh schema.
      db.exec(
        "CREATE TABLE glocon_documents (number TEXT PRIMARY KEY, business TEXT NOT NULL, kind TEXT NOT NULL, original TEXT, data TEXT NOT NULL)",
      );
      const store = createSQLiteInvoiceStore(db);
      const plan = db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT data FROM glocon_documents WHERE business=? AND original=? AND kind='financial-credit' ORDER BY rowid",
        )
        .all("example-business", "INV/2026/1");
      assert.ok(
        plan.some(
          (row) =>
            row.detail.includes("SEARCH") &&
            row.detail.includes("glocon_credit_history"),
        ),
      );
      assert.ok(
        plan.every((row) => !row.detail.includes("SCAN glocon_documents")),
      );
      const { config, order, details } = createComplianceExample("JP");
      order.lines[0].quantity = 130;
      config.products[0].unitPrice = "15";
      const original = store.issue({
        key: "capacity-order",
        config,
        order,
        details: { issuedOn: details.issuedOn },
      });
      const request = {
        date: order.date,
        reason: "Reviewed return",
        review: config.business.review,
        lines: [{ lineId: "item-1", quantity: 1 }],
      };
      const legacy = createCreditNoteDraft(
        original.document,
        { ...request, number: "CINV/2026/1" },
        [],
        { version: 1 },
      );
      assert.equal(legacy.status, "ready");
      db.prepare("INSERT INTO glocon_documents VALUES(?,?,?,?,?)").run(
        `${config.business.id}:CINV/2026/1`,
        config.business.id,
        "financial-credit",
        original.number,
        JSON.stringify({
          type: "financial-credit",
          number: "CINV/2026/1",
          document: legacy.value,
        }),
      );
      db.prepare("INSERT INTO glocon_sequences VALUES(?,?,?,?)").run(
        config.business.id,
        "CINV",
        "2026",
        1,
      );
      const unrelated = db.prepare(
        "INSERT INTO glocon_documents VALUES(?,?,?,?,?)",
      );
      db.exec("BEGIN");
      for (let index = 0; index < 10000; index++)
        unrelated.run(
          `other:INV/2026/${index}`,
          "other",
          "invoice",
          null,
          "{}",
        );
      db.exec("COMMIT");
      const history = [legacy.value];
      for (let index = 0; index < 128; index++) {
        const input = {
          business: config.business.id,
          originalNumber: original.number,
          key: `capacity-credit-${index}`,
          request,
        };
        const credit = store.credit(input);
        assert.equal(credit.document.version, 2);
        assert.equal(credit.document.previousDigest, history.at(-1).digest);
        assert.equal(credit.document.historyLength, history.length);
        assert.equal("previousDigests" in credit.document, false);
        history.push(credit.document);
        if (index === 127) assert.deepEqual(store.credit(input), credit);
      }
      const last = store.credit({
        business: config.business.id,
        originalNumber: original.number,
        key: "capacity-final",
        request,
      });
      history.push(last.document);
      for (const field of ["net", "tax", "gross"])
        assert.equal(
          history.reduce((total, credit) => total + BigInt(credit[field]), 0n),
          BigInt(original.document.calculation[field]),
        );
      assert.ok(JSON.stringify(history).length < 150000);
      assert.throws(
        () =>
          store.credit({
            business: config.business.id,
            originalNumber: original.number,
            key: "capacity-extra",
            request,
          }),
        /remaining/,
      );
      const rows = db
        .prepare(
          "SELECT data FROM glocon_documents WHERE business=? AND original=? AND kind='financial-credit' ORDER BY rowid",
        )
        .all(config.business.id, original.number);
      assert.equal(rows.length, 130);
      assert.equal(
        db
          .prepare(
            "SELECT value FROM glocon_sequences WHERE business=? AND series=? AND period=?",
          )
          .get(config.business.id, "CINV", "2026").value,
        130,
      );
    } finally {
      db.close();
    }
  },
);
