import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const minimum = manifest.engines.node.match(/^>=(\d+\.\d+\.\d+)$/)?.[1];
assert.ok(
  minimum,
  "Minimum runtime check requires an exact engines.node lower bound",
);
assert.equal(
  process.versions.node,
  minimum,
  `Run this check with Node ${minimum}; a newer runtime cannot verify the minimum`,
);
const temp = await mkdtemp(join(tmpdir(), "glocon-minimum-runtime-"));
const options = { cwd: temp, timeout: 180000, maxBuffer: 4e6 };
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
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  await writeFile(
    join(temp, "package.json"),
    JSON.stringify({
      name: "glocon-minimum-runtime-consumer",
      private: true,
      type: "module",
    }),
  );
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
      `playwright@${lock.packages["node_modules/playwright"].version}`,
      `@types/node@${lock.packages["node_modules/@types/node"].version}`,
    ],
    options,
  );
  const healthy = await readFile(join(root, "fixtures/healthy.html"), "utf8");
  await writeFile(join(temp, "healthy.html"), healthy);
  await writeFile(
    join(temp, "minimum-runtime.mjs"),
    `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createGlobalConfig, convertCurrency } from 'glocon';
import { defineCheckConfig, runChecks } from 'glocon/check';
import { defineContract, checkContract, shouldFail } from 'glocon/ui';
import { calculateOrder, createComplianceExample } from 'glocon/compliance';
assert.equal(process.versions.node, ${JSON.stringify(minimum)});
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('@axe-core/playwright'), {code:'MODULE_NOT_FOUND'});
const country = createGlobalConfig('IN');
assert.equal(country.currency.toMinorUnits('10.25'), 1025n);
const sample = createComplianceExample('JP');
const quote = calculateOrder(sample.config, sample.order);
assert.equal(quote.status, 'ready');
assert.equal(quote.value.engine, 'glocon-order-3');
assert.equal(quote.value.gross, '2200');
for (const [rounding, expected] of [['half-up','0.07'],['half-even','0.06']]) {
  assert.equal(convertCurrency({amount:'0.14',from:'USD',to:'INR',rounding,rates:{base:'JPY',rates:{USD:'28',INR:'13'},asOf:'2026-09-01T00:00:00Z',source:'exact cross-rate tie fixture'}}).amount, expected);
}
const contract = defineContract({name:'save',states:{success:{required:[{selector:'#status',description:'save status'}]}}});
assert.throws(() => checkContract(contract,{success:{visibleCounts:{}}}), /Missing or invalid observation/);
assert.throws(() => checkContract(contract,{success:{visibleCounts:{'#status':1}}},{rules:{'contract/missing-ui':'typo'}}), /Invalid severity/);
assert.throws(() => shouldFail(checkContract(contract,{success:{visibleCounts:{'#status':1}}}), 'typo'), /threshold/);
const html = await readFile('healthy.html');
const css = await readFile('node_modules/glocon/styles/glocon.css');
const server = createServer((request,response) => {
  response.setHeader('Content-Type',request.url === '/styles/glocon.css' ? 'text/css' : 'text/html');
  response.end(request.url === '/styles/glocon.css' ? css : html);
});
try {
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const report = await runChecks(defineCheckConfig({version:1,baseURL:'http://127.0.0.1:'+server.address().port,pages:['/'],viewports:[{name:'phone',width:390,height:844}],audit:{accessibility:false,readySelector:'main'},screenshots:false}), {dir:'.'});
  assert.equal(report.exitCode,0,JSON.stringify(report.cases));
  assert.equal(report.summary.completed,1);
  assert.equal(report.summary.incomplete,0);
  assert.equal(report.cases[0].report.engineVersion,'0.2.0');
  assert.equal(report.cases[0].report.coverage.complete,true);
  assert.ok(report.cases[0].report.coverage.elements > 0);
  assert.ok(report.cases[0].report.coverage.limitations.includes('axe accessibility checks were disabled.'));
} finally {await new Promise((done) => server.close(done));}
console.log('Minimum binary executed real project checks, engine-3 quote, exact FX ties and malformed runtime contracts');
`,
  );
  console.log(
    (
      await exec(process.execPath, ["minimum-runtime.mjs"], options)
    ).stdout.trim(),
  );
  const cli = await exec(
    process.execPath,
    [join(temp, "node_modules/glocon/bin/glocon.mjs"), "--version"],
    options,
  );
  assert.equal(cli.stdout.trim(), manifest.version);
  const contracts = `
import { createGlobalConfig, type CountryTaxOptions } from 'glocon';
import { defineCheckConfig, type CheckStep } from 'glocon/check';
import { calculateOrder, createComplianceExample, type Result, type Calculation } from 'glocon/compliance';
const config = defineCheckConfig({version:1,baseURL:'http://127.0.0.1:3000',pages:['/'],viewports:[{name:'phone',width:390,height:844}],audit:{accessibility:false}});
const valid: CheckStep = {action:'expect',selector:'#status',text:'Saved'};
const example = createComplianceExample('JP');
const quote: Result<Calculation> = calculateOrder(example.config,example.order);
const tax: CountryTaxOptions<'IN'> = {amount:'100',rate:'18',supply:'intra-state'};
createGlobalConfig('IN').tax.calculate(tax);
// @ts-expect-error fill requires a value
const missingValue: CheckStep = {action:'fill',selector:'#email'};
// @ts-expect-error expectation states use the documented vocabulary
const malformedState: CheckStep = {action:'expect',selector:'#status',state:'selected'};
// @ts-expect-error India requires reviewed supply treatment
const missingSupply: CountryTaxOptions<'IN'> = {amount:'100',rate:'18'};
// @ts-expect-error supported country clients retain country-specific tax contracts
createGlobalConfig('IN').tax.calculate({amount:'1000',category:'standard'});
void [config,valid,quote,missingValue,malformedState,missingSupply];
`;
  await writeFile(join(temp, "contracts.mts"), contracts);
  await writeFile(join(temp, "contracts.cts"), contracts);
  await exec(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "contracts.mts",
      "contracts.cts",
    ],
    options,
  );
  console.log(
    `Node ${minimum} minimum runtime verified from a fresh packed install: CLI ${manifest.version}, ESM/CJS TypeScript contracts and browser checks without axe.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
