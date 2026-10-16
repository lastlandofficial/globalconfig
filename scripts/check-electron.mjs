import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { _electron } from "playwright";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12))
  throw Error(
    "Packaged Electron validation tools require Node 22.12 or later.",
  );
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "glocon-electron-"));
const source = join(temp, "app");
const tools = join(temp, "tools");
const userData = join(temp, "user-data");
let application;
const errors = [];
try {
  await Promise.all([
    mkdir(tools),
    mkdir(userData),
    cp(join(root, "fixtures/electron"), source, { recursive: true }),
  ]);
  const archive = process.argv[2]
    ? resolve(process.argv[2])
    : join(
        temp,
        JSON.parse(
          (
            await exec(
              "npm",
              [
                "pack",
                "--ignore-scripts",
                "--json",
                "--pack-destination",
                temp,
              ],
              { cwd: root },
            )
          ).stdout,
        )[0].filename,
      );
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "glocon-electron-fixture",
      version: "1.0.0",
      private: true,
      main: "main.cjs",
    }),
  );
  await writeFile(
    join(tools, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { cwd: source, timeout: 180000 },
  );
  // Tooling is isolated: this optional check does not increase consumer dependencies or the Node 20 floor.
  const playwrightVersion = JSON.parse(
    await readFile(join(root, "node_modules/playwright/package.json"), "utf8"),
  ).version;
  const axeVersion = JSON.parse(
    await readFile(
      join(root, "node_modules/@axe-core/playwright/package.json"),
      "utf8",
    ),
  ).version;
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "@electron/packager@20.3.0",
      `playwright@${playwrightVersion}`,
      `@axe-core/playwright@${axeVersion}`,
      archive,
    ],
    { cwd: tools, timeout: 180000 },
  );
  await cp(
    join(source, "node_modules/glocon/styles/glocon.css"),
    join(source, "glocon.css"),
  );
  await cp(
    join(source, "node_modules/glocon/styles/tokens.css"),
    join(source, "tokens.css"),
  );
  await build({
    entryPoints: [join(source, "renderer.mjs")],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: join(source, "renderer.js"),
  });
  const require = createRequire(join(tools, "package.json"));
  const packedAPI = await import(
    pathToFileURL(require.resolve("glocon/playwright")).href
  );
  const auditPage = packedAPI.auditPage ?? packedAPI.default.auditPage;
  const { packager } = await import(
    pathToFileURL(require.resolve("@electron/packager")).href
  );
  const [packed] = await packager({
    dir: source,
    name: "glocon-electron-fixture",
    out: join(temp, "packaged"),
    platform: process.platform,
    arch: process.arch,
    electronVersion: "44.7.0",
    asar: true,
    prune: true,
    download: { cacheRoot: join(tmpdir(), "glocon-electron-downloads") },
  });
  if (process.platform !== "linux")
    throw Error("This verification currently targets packaged Linux Electron.");
  const executablePath = join(packed, "glocon-electron-fixture");
  async function launch() {
    application = await _electron.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-gpu"],
      env: {
        ...process.env,
        GLOCON_FIXTURE_DATA: userData,
        ELECTRON_RUN_AS_NODE: "",
      },
      timeout: 60000,
    });
    const page = await application.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator("#browser-result").waitFor();
    await page.waitForFunction(() =>
      document.querySelector("#browser-result").textContent.startsWith("{"),
    );
    return page;
  }
  let page = await launch();
  const runtime = await application.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    versions: process.versions,
    preferences:
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.preferences.contextIsolation, true);
  assert.equal(runtime.preferences.nodeIntegration, false);
  assert.equal(runtime.preferences.sandbox, true);
  const browser = JSON.parse(
    await page.locator("#browser-result").textContent(),
  );
  assert.deepEqual(browser, {
    engine: "glocon-order-3",
    gross: "17",
    formatted: "$9,007,199,254,740,993.01",
    roundtrip: "999999999999999999999999999999.99",
    time: "2026-11-01T06:30:00Z",
    requireType: "undefined",
  });
  await page.locator("#reference").fill("Retained input");
  await page.locator("#issue").click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "Working…",
  );
  assert.equal(await page.locator("#issue").isDisabled(), true);
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "Invoice recorded",
  );
  assert.equal(await page.locator("#total").textContent(), "17");
  await page.locator("#issue").click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "Invoice recorded",
  );
  await page.evaluate(() => window.fixtureFinance.run("fail-next"));
  await page.locator("#first-credit").click();
  await page.locator("#retry").waitFor({ state: "visible" });
  await page.locator("#retry").click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "Credit recorded",
  );
  assert.equal(await page.locator("#total").textContent(), "5");
  assert.equal(await page.locator("#reference").inputValue(), "Retained input");
  const firstAudit = await auditPage(page, {
    accessibilityMode: "same-origin",
  });
  assert.equal(firstAudit.coverage.complete, true);
  assert.deepEqual(
    firstAudit.findings,
    [],
    JSON.stringify(firstAudit.findings),
  );
  await application.close();
  application = undefined;
  page = await launch();
  const saved = await page.evaluate(() => window.fixtureFinance.run("issue"));
  assert.equal(saved.number, "INV/2026/1");
  assert.equal(saved.document.calculation.gross, "17");
  const originalCredit = await page.evaluate(() =>
    window.fixtureFinance.run("first-credit"),
  );
  assert.equal(originalCredit.number, "CINV/2026/1");
  assert.equal(originalCredit.document.gross, "5");
  const next = await page.evaluate(() =>
    window.fixtureFinance.run("final-credit"),
  );
  const last = await page.evaluate(() =>
    window.fixtureFinance.run("extra-credit"),
  );
  assert.equal(next.document.gross, "6");
  assert.equal(last.document.gross, "6");
  await assert.rejects(
    page.evaluate(() => window.fixtureFinance.run("overflow-credit")),
    /remaining/,
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(320, 740),
  );
  assert.deepEqual(
    (await auditPage(page, { accessibilityMode: "same-origin" })).findings,
    [],
  );
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "broken-fixture";
    document.querySelector("main").append(button);
  });
  const broken = await auditPage(page, { accessibilityMode: "same-origin" });
  assert.ok(
    broken.findings.some((finding) => finding.ruleId === "axe/button-name"),
  );
  assert.deepEqual(errors, []);
  const result = {
    packaged: true,
    platform: process.platform,
    architecture: process.arch,
    electron: runtime.versions.electron,
    node: runtime.versions.node,
    chromium: runtime.versions.chrome,
    rendererFinancialAndIntl: true,
    contextIsolation: true,
    sqliteRetryAndRestart: true,
    fractionalCreditTotals: ["5", "6", "6"],
    responsiveAudit: true,
    deliberateDefectDetected: true,
  };
  await writeFile(
    "/tmp/glocon-electron-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  if (process.env.GLOCON_KEEP_ELECTRON === "1")
    console.log(`Retained Electron fixture: ${temp}`);
  else await rm(temp, { recursive: true, force: true });
}
