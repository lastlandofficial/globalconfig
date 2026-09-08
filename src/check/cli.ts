import { scenarioExample } from './example';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readCheckConfig } from './config';
import { setupProject } from './setup';
import { formatCheckReport, saveBaseline } from './report';
import { runChecks, login } from './runner';

const help = `glocon — project UI checks

  glocon init --ui                 Detect the app, install tooling, generate checks and CI
  glocon check                     Start/reuse the app and check configured pages
  glocon check --example           Print loading/error/retry/success scenario templates
  glocon check --json              JSON on stdout; server logs on stderr
  glocon login                     Save a test login in an interactive browser
  glocon baseline --reason <text>  Accept reviewed findings from today's complete run

Shared: --dir <app> --help
Setup:  --url <origin> --command <start command> --pages /,/checkout
        --package-manager npm|pnpm|yarn|bun --no-install --no-ci
Checks: --config <file> (default glocon.check.json)
Baseline: --config <file> --expires YYYY-MM-DD (default: 30 days)

Reports: .glocon/report.html and .glocon/report.json
Exit codes: 0 no new findings at threshold, 1 new findings, 2 incomplete/configuration failure.
Existing glocon ui init, audit, doctor, rules, country init, and plan commands still work.
`;
export async function runCheckCommand(args: string[], version: string) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    dir: { type: 'string' }, config: { type: 'string' }, json: { type: 'boolean' }, example: { type: 'boolean' }, ui: { type: 'boolean' },
    url: { type: 'string' }, command: { type: 'string' }, pages: { type: 'string' }, 'package-manager': { type: 'string' },
    'no-install': { type: 'boolean' }, 'no-ci': { type: 'boolean' }, reason: { type: 'string' }, expires: { type: 'string' },
  } });
  if (values.version) { console.log(version); return; }
  if (values.help) { console.log(help); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !command || !['init', 'check', 'baseline', 'login'].includes(command)) throw new Error('Use glocon check --help for workflow commands.');
  const supported = command === 'init' ? ['ui', 'url', 'command', 'pages', 'package-manager', 'no-install', 'no-ci'] : command === 'baseline' ? ['config', 'reason', 'expires'] : command === 'check' ? ['config', 'json', 'example'] : ['config'];
  for (const key of Object.keys(values)) if (!['dir', 'help', 'version', ...supported].includes(key)) throw new Error(`--${key} is not supported by glocon ${command}.`);
  const dir = resolve(values.dir ?? '.');
  if (command === 'init') {
    await setupProject({ dir, version, ...(values.url ? { url: values.url } : {}), ...(values.command ? { command: values.command } : {}), ...(values.pages ? { pages: values.pages } : {}), ...(values['package-manager'] ? { manager: values['package-manager'] } : {}), ...(values['no-install'] ? { noInstall: true } : {}), ...(values['no-ci'] ? { noCI: true } : {}) });
    return;
  }
  if (command === 'check' && values.example) {
    if (values.config || values.json) throw new Error('--example cannot be combined with --config or --json.');
    console.log(JSON.stringify(scenarioExample(), null, 2)); return;
  }
  const config = await readCheckConfig(dir, values.config);
  if (command === 'login') { await login(config, dir); return; }
  if (command === 'baseline') {
    const count = await saveBaseline(dir, config, values.reason ?? '', values.expires);
    console.log(`Recorded ${count} reviewed finding(s) in glocon.baseline.json. Commit this file and run glocon check again.`);
    return;
  }
  const report = await runChecks(config, { dir });
  console.log(values.json ? JSON.stringify(report, null, 2) : `${formatCheckReport(report)}\n\nReport: ${resolve(dir, '.glocon/report.html')}`);
  process.exitCode = report.exitCode;
}
