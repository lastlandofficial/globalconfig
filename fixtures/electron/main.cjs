const { app, BrowserWindow, ipcMain } = require("electron");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createMeteredComplianceExample } = require("glocon/compliance");
const { createSQLiteInvoiceStore } = require("glocon/compliance/server");

// Only this verification fixture uses the driver-selected isolated data directory.
app.setPath("userData", process.env.GLOCON_FIXTURE_DATA);
const sample = createMeteredComplianceExample("JP");
let db;
let store;
let window;
let failNext = false;
const invoice = () =>
  store.issue({
    key: "metered-invoice",
    config: sample.config,
    order: sample.order,
    details: { issuedOn: sample.details.issuedOn },
  });

app.whenReady().then(() => {
  db = new DatabaseSync(join(app.getPath("userData"), "documents.sqlite"));
  store = createSQLiteInvoiceStore(db);
  ipcMain.handle("fixture:finance", async (event, action) => {
    if (event.sender !== window.webContents) throw Error("Unknown renderer");
    if (action === "fail-next") {
      failNext = true;
      return;
    }
    // A short deterministic delay makes the fixture's pending state observable.
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (failNext) {
      failNext = false;
      throw Error("Fixture service unavailable");
    }
    if (action === "issue") return invoice();
    if (
      ![
        "first-credit",
        "final-credit",
        "extra-credit",
        "overflow-credit",
      ].includes(action)
    )
      throw Error("Unknown fixture action");
    return store.credit({
      business: sample.config.business.id,
      originalNumber: invoice().number,
      key: action,
      request: {
        date: sample.order.date,
        reason: "Reviewed metered return fixture",
        review: sample.config.business.review,
        lines: [{ lineId: "item-1", quantity: "0.1" }],
      },
    });
  });
  window = new BrowserWindow({
    width: 800,
    height: 760,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.loadFile(join(__dirname, "index.html"));
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => db?.close());
