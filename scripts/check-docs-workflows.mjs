import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const temp = await mkdtemp(join(tmpdir(), "glocon-docs-workflows-"));
const server = createServer();
const options = { cwd: temp, timeout: 180000, maxBuffer: 4e6 };
function shellBlocks(text) {
  return [...text.matchAll(/```sh\s*\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
}
function words(command) {
  // Documented commands use literal arguments, with quotes only around selectors.
  assert.ok(
    !/[`$;|&<>]/.test(command),
    `Unsupported shell syntax in documented command: ${command}`,
  );
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
}
async function documentedCLI(command) {
  const args = words(command);
  assert.deepEqual(args.slice(0, 3), ["npx", "--no-install", "glocon"]);
  return exec(args[0], args.slice(1), options);
}

try {
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
              { cwd: root, maxBuffer: 4e6 },
            )
          ).stdout,
        )[0].filename,
      );
  const [readme, uiGuide, financialGuide, lock] = await Promise.all([
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "docs/ui/README.md"), "utf8"),
    readFile(join(root, "docs/compliance/README.md"), "utf8"),
    readFile(join(root, "package-lock.json"), "utf8").then(JSON.parse),
  ]);
  const standalone = shellBlocks(uiGuide).find(
    (block) => block.includes("glocon audit") && block.includes("npm install"),
  );
  assert.ok(
    standalone,
    "UI guide must contain a complete standalone installation block",
  );
  const install = standalone
    .split("\n")
    .find((line) => line.startsWith("npm install -D "));
  const dependencies = words(install).slice(3);
  assert.deepEqual(
    [...dependencies].sort(),
    ["@axe-core/playwright", "playwright"],
    "Standalone audit guide must install both peers",
  );
  assert.ok(
    standalone.includes("npx --no-install playwright install chromium"),
    "Standalone guide omits Chromium installation",
  );
  await writeFile(
    join(temp, "package.json"),
    JSON.stringify({
      name: "glocon-documented-consumer",
      private: true,
      type: "module",
    }),
  );
  // Pin the documented peer names to this checkout's tested versions so cached Chromium matches.
  const peers = dependencies.map(
    (name) => `${name}@${lock.packages[`node_modules/${name}`].version}`,
  );
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
      ...peers,
    ],
    options,
  );
  const installed = JSON.parse(
    await readFile(join(temp, "node_modules/glocon/package.json"), "utf8"),
  );
  assert.equal(installed.version, manifest.version);
  assert.equal(
    (await documentedCLI("npx --no-install glocon --version")).stdout.trim(),
    manifest.version,
  );

  const country = [...readme.matchAll(/```ts\s*\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .find((block) => block.includes("const india = createGlobalConfig('IN')"));
  assert.ok(country, "README country quickstart was not found");
  await writeFile(
    join(temp, "country-quickstart.mjs"),
    `${country}\nimport assert from 'node:assert/strict';\nassert.equal(india.currency.format('123456.78'), '₹1,23,456.78');\nassert.equal(india.currency.toMinorUnits('10.25'), 1025n);\nassert.equal(india.time.convert('2026-09-01T12:00:00Z').local, '2026-09-01T17:30:00');\nassert.equal(india.tax.calculate({amount:'1000',rate:'18',supply:'intra-state'}).gross, '1180.00');\nassert.ok(plan.tasks.length > 0);\n`,
  );
  await exec(process.execPath, ["country-quickstart.mjs"], options);

  const financial = shellBlocks(financialGuide).find(
    (block) =>
      block.includes("glocon compliance init --country JP --demo") &&
      block.includes("glocon invoice render"),
  );
  assert.ok(
    financial,
    "Financial guide must contain the complete demo workflow",
  );
  const commands = financial
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("npx --no-install glocon "));
  assert.equal(
    commands.length,
    7,
    "Financial guide must cover version, setup, checks, quote, invoice creation, validation and rendering",
  );
  for (const command of commands) {
    const result = await documentedCLI(command);
    if (command.includes(" tax quote ")) {
      const quote = JSON.parse(result.stdout);
      assert.equal(quote.status, "ready");
      assert.equal(quote.value.engine, "glocon-order-3");
      assert.deepEqual(
        [quote.value.net, quote.value.tax, quote.value.gross],
        ["2000", "200", "2200"],
      );
    }
    if (command.includes(" invoice validate "))
      assert.equal(JSON.parse(result.stdout).valid, true);
  }
  const financialReport = JSON.parse(
    await readFile(join(temp, ".glocon/compliance-report.json"), "utf8"),
  );
  assert.equal(financialReport.exitCode, 0);
  assert.equal(financialReport.coverage.scope, "invoices");
  assert.ok(
    financialReport.coverage.invoices.ready > 0 &&
      financialReport.coverage.gaps.length === 0,
  );
  const invoice = JSON.parse(
    await readFile(join(temp, "invoice.json"), "utf8"),
  );
  assert.equal(invoice.calculation.engine, "glocon-order-3");
  const html = await readFile(join(temp, "invoice.html"), "utf8");
  assert.ok(
    html.startsWith("<!doctype html>") &&
      html.includes("Invoice draft") &&
      html.includes(invoice.details.number) &&
      html.includes("2200 JPY"),
    "Rendered invoice must contain the validated draft's identity and totals",
  );

  const [healthy, css] = await Promise.all([
    readFile(join(root, "fixtures/healthy.html")),
    readFile(join(temp, "node_modules/glocon/styles/glocon.css")),
  ]);
  server.on("request", (request, response) => {
    if (request.url === "/styles/glocon.css") {
      response.setHeader("Content-Type", "text/css");
      response.end(css);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(healthy);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const audit = standalone
    .split("\n")
    .find(
      (line) =>
        line.startsWith("npx --no-install glocon audit ") &&
        line.includes("--json"),
    );
  assert.ok(audit, "Standalone guide must document a JSON audit command");
  const report = JSON.parse(
    (await documentedCLI(audit.replace("http://localhost:3000", baseURL)))
      .stdout,
  );
  assert.equal(report.schemaVersion, "1.0");
  assert.equal(report.engineVersion, "0.2.0");
  assert.equal(report.coverage.complete, true);
  assert.ok(
    report.coverage.elements > 0 &&
      report.coverage.rules.some((rule) => rule.startsWith("axe/")),
    "Documented installation must perform real layout and axe checks",
  );
  assert.equal(report.summary.error, 0, JSON.stringify(report.findings));
  console.log(
    `Documented packed workflows pass: glocon ${manifest.version}, README country quickstart, engine-3 exact invoice acceptance/HTML and standalone Chromium audit with both optional peers.`,
  );
} finally {
  if (server.listening) await new Promise((done) => server.close(done));
  await rm(temp, { recursive: true, force: true });
}
