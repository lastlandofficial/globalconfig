import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { validateComplianceConfig } from "./validation";
import {
  createComplianceExample,
  createMeteredComplianceExample,
} from "./example";
import { calculateOrder } from "./engine";
import { checkFinancialCases } from "./check";
import {
  createInvoiceDraft,
  validateInvoice,
  renderInvoiceHTML,
} from "./invoice";
import {
  createComplianceLock,
  canonical,
  compareRulePacks,
  requirements,
  digest,
} from "./rules";
import { checkSources } from "./sources";
import type { CountryCode } from "../countries";
import type {
  ComplianceConfig,
  InvoiceDetails,
  InvoiceDraft,
  Order,
} from "./types";
const help = `glocon — tax and invoice workflows

  glocon compliance init --country IN|JP|US [--demo [--metered]]
  glocon compliance init --input reviewed-config.json
  glocon compliance check [--scope invoices|quotes|both]
  glocon compliance lock
  glocon compliance explain <requirement-id>
  glocon compliance rules diff <candidate-config.json>
  glocon compliance sources check [--record]
  glocon tax quote <order.json>
  glocon invoice create <order.json> --details <details.json> [--output <file>]
  glocon invoice validate <invoice.json>
  glocon invoice render <invoice.json> --output <file.html>

Shared: --dir <app> --config <file> --json --help
Default config: glocon.compliance.json. Setup preserves existing files.
--demo creates fictional test data, not reviewed production classifications.
Exit codes: 0 configured checks passed, 1 violations, 2 incomplete/configuration failure.
`;
const readJSON = async (file: string) =>
  JSON.parse(await readFile(file, "utf8"));
async function writeNew(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    { flag: "wx" },
  );
}
async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
export async function runComplianceCommand(args: string[]) {
  const { values: v, positionals: p } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      dir: { type: "string" },
      config: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      country: { type: "string" },
      demo: { type: "boolean" },
      input: { type: "string" },
      details: { type: "string" },
      output: { type: "string" },
      record: { type: "boolean" },
      scope: { type: "string" },
      metered: { type: "boolean" },
    },
  });
  if (v.help) {
    console.log(help);
    return;
  }
  const command = p.slice(0, 2).join(" "),
    dir = resolve(v.dir ?? "."),
    file = resolve(dir, v.config ?? "glocon.compliance.json");
  const allowed: Record<string, string[]> = {
    "compliance init": ["country", "demo", "input", "metered"],
    "compliance check": ["scope"],
    "compliance lock": [],
    "compliance explain": [],
    "compliance rules": [],
    "compliance sources": ["record"],
    "tax quote": [],
    "invoice create": ["details", "output"],
    "invoice validate": [],
    "invoice render": ["output"],
  };
  if (!allowed[command]) throw Error(help);
  for (const key of Object.keys(v))
    if (!["dir", "config", "json", "help", ...allowed[command]!].includes(key))
      throw Error(`--${key} is not supported for ${command}.`);
  const count =
    command === "compliance rules"
      ? 4
      : command === "compliance sources"
        ? 3
        : [
              "compliance explain",
              "tax quote",
              "invoice create",
              "invoice validate",
              "invoice render",
            ].includes(command)
          ? 3
          : 2;
  if (p.length !== count)
    throw Error(`Invalid arguments for ${command}. See --help.`);
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === "compliance init") {
    if (await exists(file)) {
      console.log(`Preserved ${file}. Run glocon compliance check.`);
      return;
    }
    if (v.input && (v.demo || v.country || v.metered))
      throw Error(
        "--input cannot be combined with --demo, --metered or --country.",
      );
    if (v.metered && !v.demo)
      throw Error(
        "--metered requires --demo. Use --input with your reviewed billing policy for production.",
      );
    let config: ComplianceConfig,
      example: ReturnType<typeof createComplianceExample>;
    if (v.input) {
      config = validateComplianceConfig(await readJSON(resolve(dir, v.input)));
      example = createComplianceExample(config.business.country);
    } else {
      let country = v.country;
      if (!country && process.stdin.isTTY) {
        const prompt = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          country = (await prompt.question("Business country (IN, JP, US): "))
            .trim()
            .toUpperCase();
        } finally {
          prompt.close();
        }
      }
      if (!country || !["IN", "JP", "US"].includes(country))
        throw Error(
          "Choose --country IN, JP, or US; use --input for reviewed configuration.",
        );
      example = (
        v.metered ? createMeteredComplianceExample : createComplianceExample
      )(country as CountryCode, new Date().toISOString().slice(0, 10));
      config = example.config;
      if (!v.demo) {
        config.business.environment = "production";
        config.business.registration = "unknown";
        delete config.business.review;
        delete config.business.registrationId;
        config.rules.treatments = [];
        config.business.name = "REPLACE with your business name";
        config.business.address = "REPLACE with your business address";
        if (config.business.india)
          config.business.india = { eInvoice: "unknown", signature: "unknown" };
      }
    }
    config.$schema = "./node_modules/glocon/docs/compliance/config.schema.json";
    const cases = v.input
      ? []
      : [
          {
            name: "example order",
            order: example.order,
            details: example.details,
            expected: v.demo ? { ...example.expected } : { status: "ready" },
          },
        ];
    const files: [[string, unknown], ...[string, unknown][]] = [
      [file, config],
      [
        resolve(dir, "glocon.compliance.lock.json"),
        createComplianceLock(config),
      ],
      [resolve(dir, "glocon.compliance.cases.json"), cases],
      [resolve(dir, "glocon.examples/order.json"), example.order],
      [resolve(dir, "glocon.examples/invoice-details.json"), example.details],
      [
        resolve(dir, "glocon.examples/server.mjs"),
        `// Node.js 22.13+ example. Use server-owned config, catalog and authenticated buyer data.\nimport { DatabaseSync } from 'node:sqlite';\nimport { readFile } from 'node:fs/promises';\nimport { createSQLiteInvoiceStore } from 'glocon/compliance/server';\nconst config = JSON.parse(await readFile('glocon.compliance.json'));\nconst order = JSON.parse(await readFile('glocon.examples/order.json'));\nconst db = new DatabaseSync('glocon-invoices.sqlite');\ntry {\n const store = createSQLiteInvoiceStore(db);\n const invoice = store.issue({key:'example-order-v1',config,order,details:{issuedOn:order.date}});\n console.log(invoice);\n} finally {db.close();}\n`,
      ],
    ];
    // Preflight all destinations; a partial existing setup must be repaired deliberately.
    for (const [target] of files)
      if (await exists(target))
        throw Error(
          `Preserved existing ${target}; choose an empty setup directory or reconcile its configuration.`,
        );
    for (const [target, value] of files) await writeNew(target, value);
    console.log(
      `Created ${file}. ${config.business.environment === "test" ? "Fictional test data only." : "Complete the business review and product treatments before quoting."}\nInstall glocon locally if needed. Run glocon compliance check. Financial reports are written under .glocon/.`,
    );
    return;
  }
  if (command === "compliance explain") {
    const r = requirements.find((r) => r.id === p[2]);
    if (!r) throw Error("Unknown requirement ID.");
    print(r);
    return;
  }
  if (command === "invoice validate" || command === "invoice render") {
    const invoice = (await readJSON(resolve(dir, p[2]!))) as InvoiceDraft;
    const result = validateInvoice(invoice);
    if (command === "invoice render") {
      if (!v.output) throw Error("Provide --output for HTML.");
      await writeNew(resolve(dir, v.output), renderInvoiceHTML(invoice));
    } else print(result);
    process.exitCode = result.valid ? 0 : 1;
    return;
  }
  if (command === "compliance check")
    await rm(resolve(dir, ".glocon/compliance-report.json"), { force: true });
  const config = validateComplianceConfig(await readJSON(file));
  if (command === "compliance lock") {
    await writeFile(
      resolve(dir, "glocon.compliance.lock.json"),
      JSON.stringify(createComplianceLock(config), null, 2) + "\n",
    );
    console.log(
      "Pinned config and rule digests. This does not approve tax treatments or source reviews.",
    );
    return;
  }
  const lock = await readJSON(resolve(dir, "glocon.compliance.lock.json"));
  if (canonical(lock) !== canonical(createComplianceLock(config)))
    throw Error(
      "Configuration differs from the lock. Review changes, then run glocon compliance lock.",
    );
  if (command === "compliance rules") {
    if (p[2] !== "diff")
      throw Error("Use compliance rules diff <candidate-config.json>.");
    const candidate = validateComplianceConfig(
      await readJSON(resolve(dir, p[3]!)),
    );
    print(compareRulePacks(config.rules, candidate.rules));
    return;
  }
  if (command === "compliance sources") {
    if (p[2] !== "check") throw Error("Use compliance sources check.");
    const target = resolve(dir, "glocon.sources.json");
    const baseline = (await exists(target)) ? await readJSON(target) : {};
    const results = await checkSources(config.rules.requirements, baseline);
    print(results);
    if (v.record) {
      for (const r of results) if (r.digest) baseline[r.url] = r.digest;
      await writeFile(target, JSON.stringify(baseline, null, 2) + "\n");
    }
    process.exitCode = results.some(
      (r) =>
        r.status === "unavailable" ||
        (r.status === "not-checked" && (!v.record || !r.digest)),
    )
      ? 2
      : results.some((r) => r.status === "changed")
        ? 1
        : 0;
    return;
  }
  if (command === "tax quote" || command === "invoice create") {
    const order = (await readJSON(resolve(dir, p[2]!))) as Order;
    if (command === "invoice create" && !v.details)
      throw Error("Provide --details <invoice-details.json>.");
    const result =
      command === "tax quote"
        ? calculateOrder(config, order)
        : createInvoiceDraft(
            config,
            order,
            (await readJSON(resolve(dir, v.details!))) as InvoiceDetails,
          );
    if (v.output && result.status === "ready")
      await writeNew(resolve(dir, v.output), result.value);
    else print(result);
    process.exitCode =
      result.status === "ready" ? 0 : result.status === "invalid" ? 1 : 2;
    return;
  }
  const suite = checkFinancialCases(
    config,
    await readJSON(resolve(dir, "glocon.compliance.cases.json")),
    v.scope ? { scope: v.scope as "quotes" | "invoices" | "both" } : {},
  );
  const results = suite.cases;
  const code = suite.exitCode;
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    environment: config.business.environment,
    configDigest: digest(config),
    cases: results,
    coverage: suite.coverage,
    exitCode: code,
    scope:
      "Fixture expectations and selected invoice checks; no legal certification or network source check.",
  };
  await mkdir(resolve(dir, ".glocon"), { recursive: true });
  await writeFile(
    resolve(dir, ".glocon/compliance-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  if (v.json) print(report);
  else
    console.log(
      `${results.filter((r) => r.passed).length}/${results.length} financial cases passed. ${suite.coverage.quotes.ready} ready quote(s), ${suite.coverage.invoices.ready} ready invoice(s). Acceptance scope: ${suite.coverage.scope}.\n${results
        .filter((r) => !r.passed)
        .map((r) => `${r.name}: ${r.status}`)
        .join(
          "\n",
        )}\n${suite.coverage.gaps.join("\n")}\nReport: .glocon/compliance-report.json`,
    );
  process.exitCode = code;
}
