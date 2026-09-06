#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createGlobalConfig, resolveTimeZone } from '../dist/index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const setupFiles = ['glocon.config.json', 'globalconfig.js', 'globalconfig.d.ts', 'globalconfig.cjs', 'globalconfig.d.cts'];
const managers = ['npm', 'pnpm', 'yarn', 'bun'];

function help() {
  console.log(`globalconfig (glocon ${manifest.version})

Usage:
  glocon ui init                      Set up UI checks (no country required)
  glocon audit <url>                   Check a running app for UI issues
  glocon doctor [directory]            Detect frameworks and explain integrations
  glocon rules                        List UI audit rules
  glocon init                         Guided country configuration
  glocon init --country IN             Set up India without prompts
  glocon init --country US --time-zone America/New_York
  glocon plan                         Show questions and implementation tasks
  glocon plan --json                   Print the plan as JSON

Options:
  --dir <path>                        Project directory (default: current directory)
  --country <IN|US|JP>                 Country code or supported name (init)
  --locale <locale>                    Override the country's locale (init)
  --time-zone <IANA zone>              Set the time zone (init)
  --package-manager <npm|pnpm|yarn|bun> Override package manager detection (init)
  --no-install                        Write setup files without installing dependencies (init)
  --on <YYYY-MM-DD>                    Review date (plan; default: UTC today)
  --json                              Machine-readable output (plan)
  --help                              Show help
  --version                           Show package version

init creates a JSON config, clients for frontend bundlers and Node.js with TypeScript declarations,
and adds glocon to local dependencies. Existing setup files are never overwritten.
plan uses bundled government-source checklists; it does not fetch legal updates.`);
}

function readObject(file) {
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Cannot read ${file}: ${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file} must contain a JSON object`);
  return value;
}

function detectManager(dir, pkg, requested) {
  if (requested) {
    if (!managers.includes(requested)) throw new Error('--package-manager must be npm, pnpm, yarn, or bun');
    return requested;
  }
  if (pkg.packageManager) {
    const manager = String(pkg.packageManager).split('@')[0];
    if (!managers.includes(manager)) throw new Error(`Unsupported packageManager: ${pkg.packageManager}. Pass --package-manager explicitly.`);
    return manager;
  }
  const found = [
    ['npm', ['package-lock.json', 'npm-shrinkwrap.json']],
    ['pnpm', ['pnpm-lock.yaml']],
    ['yarn', ['yarn.lock']],
    ['bun', ['bun.lock', 'bun.lockb']],
  ].filter(([, files]) => files.some(file => existsSync(join(dir, file)))).map(([manager]) => manager);
  if (found.length > 1) throw new Error('Multiple package-manager lockfiles found. Pass --package-manager explicitly.');
  return found[0] ?? 'npm';
}

async function init(dir, values) {
  for (const file of setupFiles) {
    if (existsSync(join(dir, file))) throw new Error(`${file} already exists. Edit your existing setup; init will not overwrite it.`);
  }
  let country = values.country;
  let timeZone = values['time-zone'];
  if (!country) {
    if (!process.stdin.isTTY) throw new Error('Pass --country IN, US, or JP when running without an interactive terminal.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      country = (await prompt.question('Country (IN / US / JP): ')).trim();
      if (!country) throw new Error('A country is required.');
      if (createGlobalConfig(country).country.code === 'US' && !timeZone) {
        timeZone = (await prompt.question('US IANA time zone (leave blank to configure time later): ')).trim() || undefined;
      }
    } finally { prompt.close(); }
  }
  const app = createGlobalConfig({ country, ...(values.locale ? { locale: values.locale } : {}), ...(timeZone ? { timeZone } : {}) });
  const config = {
    country: app.country.code,
    ...(values.locale ? { locale: values.locale } : {}),
    ...(timeZone ? { timeZone: resolveTimeZone(timeZone) } : {}),
    facts: {},
    records: [],
  };
  const packagePath = join(dir, 'package.json');
  const pkg = existsSync(packagePath) ? readObject(packagePath) : { private: true };
  if (pkg.name === manifest.name) throw new Error('Run glocon init in an application directory; this directory is the glocon package itself.');
  for (const field of ['dependencies', 'scripts']) {
    if (pkg[field] !== undefined && (!pkg[field] || typeof pkg[field] !== 'object' || Array.isArray(pkg[field]))) throw new Error(`package.json ${field} must be an object`);
  }
  const manager = detectManager(dir, pkg, values['package-manager']);
  const updatedPackage = {
    ...pkg,
    dependencies: { ...pkg.dependencies, glocon: `^${manifest.version}` },
    scripts: { 'globalconfig:plan': 'glocon plan', ...pkg.scripts },
  };
  const client = `// globalconfig: a Node.js client configured from glocon.config.json.
const { createGlobalConfig } = require('glocon');
const config = require('./glocon.config.json');
const app = createGlobalConfig(config);
module.exports = app;
`;
  const declarations = `import type { GlobalConfig } from 'glocon';
declare const globalconfig: GlobalConfig;
export = globalconfig;
`;
  const frontendClient = `// For React, Next.js, React Native, and Electron renderer bundlers.
import { createGlobalConfig } from 'glocon';
import config from './glocon.config.json';
export const globalconfig = createGlobalConfig(config);
export default globalconfig;
`;
  const frontendDeclarations = `import type { GlobalConfig } from 'glocon';
export declare const globalconfig: GlobalConfig;
export default globalconfig;
`;
  const contents = [JSON.stringify(config, null, 2) + '\n', frontendClient, frontendDeclarations, client, declarations];
  mkdirSync(dir, { recursive: true });
  setupFiles.forEach((file, index) => writeFileSync(join(dir, file), contents[index], { flag: 'wx' }));
  writeFileSync(packagePath, JSON.stringify(updatedPackage, null, 2) + '\n');
  console.log(`Configured globalconfig for ${app.country.name} in ${dir}.`);
  if (!values['no-install']) {
    console.log(`Installing local dependencies with ${manager}...`);
    try {
      execFileSync(manager, manager === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['install'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
    } catch {
      throw new Error(`Setup files were created, but installation failed. Run ${manager} install in ${dir}, then glocon plan.`);
    }
  }
  if (values['no-install']) console.log(`Next: run ${manager} install in the project directory.`);
  console.log('Run glocon plan in the project directory and answer its questions in glocon.config.json.');
  console.log("Frontend bundlers: import { globalconfig } from './globalconfig.js';");
  console.log("Node.js: import globalconfig from './globalconfig.cjs';");
  if (config.country === 'US' && !config.timeZone) console.log('Set timeZone in glocon.config.json before using US time helpers.');
}

function plan(dir, values) {
  const path = join(dir, 'glocon.config.json');
  if (!existsSync(path)) throw new Error('No glocon.config.json found. Run glocon init first, or pass --dir.');
  const config = readObject(path);
  const allowed = ['country', 'locale', 'timeZone', 'facts', 'records'];
  for (const key of Object.keys(config)) {
    if (!allowed.includes(key)) throw new Error(`Unknown config field: ${key}. Supported: ${allowed.join(', ')}`);
  }
  if (config.facts !== undefined && (!config.facts || typeof config.facts !== 'object' || Array.isArray(config.facts))) throw new Error('facts must be an object of boolean answers; omit unanswered facts.');
  if (config.records !== undefined && !Array.isArray(config.records)) throw new Error('records must be an array of control records.');
  const app = createGlobalConfig(config);
  const report = app.laws.plan(values.on ? { on: values.on } : {});
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`globalconfig — ${app.country.name} — ${report.on}\n`);
  console.log(report.scope);
  console.log(`\nQuestions (${report.questions.length}) — set boolean answers in glocon.config.json under facts:`);
  for (const question of report.questions) {
    console.log(`  ${question.fact}: ${question.question}\n    ${question.help}`);
    for (const source of question.sources) console.log(`    Source: ${source}`);
  }
  console.log(`\nImplementation tasks (${report.tasks.length}):`);
  for (const task of report.tasks) {
    console.log(`\n  [${task.status}] ${task.ruleId}/${task.controlId}: ${task.title}`);
    console.log(`    ${task.jurisdiction} | ${task.applicability} | ${task.timing}`);
    console.log(`    Timing: ${task.timingNote}`);
    for (const step of task.implementation) console.log(`    - ${step}`);
    for (const evidence of task.evidence) console.log(`    Evidence: ${evidence}`);
    console.log(`    Source: ${task.source} (reviewed ${task.reviewedOn})`);
  }
  if (report.sourcesToReview.length) console.log(`\nRecheck ${report.sourcesToReview.length} source(s) for the requested date; this command uses bundled data.`);
  console.log(`\nRecorded progress: ${report.progress.done} done, ${report.progress.inProgress} in progress, ${report.progress.todo} to do, ${report.progress.notApplicable} marked not applicable.`);
}

const uiCommand = process.argv[2];
if (['ui', 'audit', 'doctor', 'rules'].includes(uiCommand)) {
  try {
    const { runUICommand } = await import('../dist/ui/cli/index.js');
    await runUICommand(process.argv.slice(uiCommand === 'ui' ? 3 : 2), manifest.version);
  } catch (error) {
    console.error(`glocon: ${error.message}`);
    process.exitCode = 2;
  }
} else try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      dir: { type: 'string' }, country: { type: 'string' }, locale: { type: 'string' },
      'time-zone': { type: 'string' }, 'package-manager': { type: 'string' },
      'no-install': { type: 'boolean' }, on: { type: 'string' }, json: { type: 'boolean' },
    },
  });
  if (values.version) console.log(manifest.version);
  else if (values.help || positionals.length === 0) help();
  else {
    const [command] = positionals;
    if (positionals.length !== 1 || !['init', 'plan'].includes(command)) throw new Error('Use glocon init or glocon plan. Run glocon --help for options.');
    const invalid = command === 'init' ? ['on', 'json'] : ['country', 'locale', 'time-zone', 'package-manager', 'no-install'];
    for (const option of invalid) if (values[option] !== undefined) throw new Error(`--${option} is not supported by glocon ${command}.`);
    const dir = resolve(values.dir ?? process.cwd());
    if (command === 'init') await init(dir, values);
    else plan(dir, values);
  }
} catch (error) {
  console.error(`glocon: ${error.message}`);
  process.exitCode = 1;
}
