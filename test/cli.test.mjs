import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('bin/glocon.mjs');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const run = (dir, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
function project(t) {
  const dir = mkdtempSync(join(tmpdir(), 'glocon-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('CLI help and version work before any project is configured', t => {
  const dir = project(t);
  assert.match(run(dir, '--help').stdout, /glocon init/);
  assert.equal(run(dir, '--version').stdout.trim(), version);
  assert.equal(run(dir).status, 0);
  assert.equal(run(dir, 'unknown').status, 1);
  assert.match(run(dir, 'plan').stderr, /glocon init/);
  assert.deepEqual(readdirSync(dir), []);
});

test('init creates shared configuration and frontend/Node clients without overwriting project settings', t => {
  const dir = project(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'existing-app', type: 'module', dependencies: { existing: '1.0.0' }, scripts: { test: 'existing-test', 'globalconfig:plan': 'existing-plan' } }));
  const result = run(dir, 'init', '--country', 'India', '--no-install');
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.glocon, `^${version}`);
  assert.equal(pkg.dependencies.existing, '1.0.0');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts['globalconfig:plan'], 'existing-plan');
  assert.equal(pkg.scripts.test, 'existing-test');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'glocon.config.json'), 'utf8')), { country: 'IN', facts: {}, records: [] });
  assert.match(readFileSync(join(dir, 'globalconfig.js'), 'utf8'), /import config from '.\/glocon.config.json'/);
  assert.doesNotMatch(readFileSync(join(dir, 'globalconfig.js'), 'utf8'), /node:|process\./);
  assert.match(readFileSync(join(dir, 'globalconfig.cjs'), 'utf8'), /require\('.\/glocon.config.json'\)/);
  assert.match(readFileSync(join(dir, 'globalconfig.d.ts'), 'utf8'), /GlobalConfig/);
  const filesBefore = readdirSync(dir).map(file => [file, readFileSync(join(dir, file), 'utf8')]);
  const retry = run(dir, 'init', '--country', 'JP', '--no-install');
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /will not overwrite/);
  for (const [file, text] of filesBefore) assert.equal(readFileSync(join(dir, file), 'utf8'), text);
});

test('invalid setup fails before creating files and noninteractive use does not hang', t => {
  const dir = project(t);
  for (const args of [[], ['--country', 'FR'], ['--country', 'US', '--time-zone', 'Mars/Olympus'], ['--country', 'IN', '--json'], ['--country', 'IN', '--package-manager', 'unknown']]) {
    assert.equal(run(dir, 'init', '--no-install', ...args).status, 1);
    assert.deepEqual(readdirSync(dir), []);
  }
  writeFileSync(join(dir, 'globalconfig.js'), 'user code');
  assert.equal(run(dir, 'init', '--country', 'JP', '--no-install').status, 1);
  assert.deepEqual(readdirSync(dir), ['globalconfig.js']);
});

test('init honors package-manager metadata and handles ambiguous lockfiles explicitly', t => {
  const dir = project(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }));
  const result = run(dir, 'init', '--country', 'US', '--time-zone', 'America/New_York', '--no-install');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pnpm install/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'glocon.config.json'), 'utf8')).timeZone, 'America/New_York');
  const ambiguous = project(t);
  writeFileSync(join(ambiguous, 'yarn.lock'), '');
  writeFileSync(join(ambiguous, 'package-lock.json'), '{}');
  assert.match(run(ambiguous, 'init', '--country', 'JP', '--no-install').stderr, /Multiple package-manager/);
  assert.equal(run(ambiguous, 'init', '--country', 'JP', '--no-install', '--package-manager', 'npm').status, 0);
});

test('plan produces JSON questions, source-linked tasks, and restored progress from saved configuration', t => {
  const dir = project(t);
  assert.equal(run(dir, 'init', '--country', 'JP', '--no-install').status, 0);
  let result = run(dir, 'plan', '--json', '--on', '2026-09-06');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).questions.length, 2);
  writeFileSync(join(dir, 'glocon.config.json'), JSON.stringify({ country: 'JP', facts: { collectsPersonalData: false, sellsTaxableItems: true }, records: [{ ruleId: 'jp-tax-review', controlId: 'registration', status: 'done', note: 'Reviewed registration', updatedAt: '2026-09-06T00:00:00Z' }] }));
  result = run(dir, 'plan', '--json', '--on', '2026-09-07');
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.questions.length, 0);
  assert.equal(plan.progress.done, 1);
  assert.ok(plan.tasks.every(task => task.ruleId === 'jp-tax-review'));
  assert.ok(plan.sourcesToReview.length);
  const text = run(dir, 'plan').stdout;
  assert.match(text, /Source: https:/);
  assert.match(text, /Evidence:/);
  assert.match(text, /Recorded progress:/);
});

test('plan rejects invalid configuration and dates with actionable errors', t => {
  const dir = project(t);
  for (const config of [{ country: 'IN', fact: {} }, { country: 'IN', facts: [] }, { country: 'IN', facts: { unknown: true } }, { country: 'IN', records: {} }]) {
    writeFileSync(join(dir, 'glocon.config.json'), JSON.stringify(config));
    const result = run(dir, 'plan', '--json');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /glocon:/);
    assert.equal(result.stdout, '');
  }
  writeFileSync(join(dir, 'glocon.config.json'), '{ invalid json');
  assert.match(run(dir, 'plan').stderr, /Cannot read/);
  writeFileSync(join(dir, 'glocon.config.json'), JSON.stringify({ country: 'IN' }));
  assert.equal(run(dir, 'plan', '--on', '2026-02-30').status, 1);
  assert.match(run(dir, 'plan', '--country', 'US').stderr, /not supported/);
});

test('failed installation keeps generated setup and tells the developer how to finish', t => {
  const dir = project(t);
  const result = spawnSync(process.execPath, [cli, 'init', '--country', 'IN', '--package-manager', 'npm'], {
    cwd: dir, encoding: 'utf8', timeout: 20_000, env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Setup files were created, but installation failed/);
  assert.match(result.stderr, /npm install/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'glocon.config.json'), 'utf8')).country, 'IN');
});

test('init refuses to add the library as its own dependency', t => {
  const dir = project(t);
  const text = JSON.stringify({ name: 'glocon', private: true });
  writeFileSync(join(dir, 'package.json'), text);
  const result = run(dir, 'init', '--country', 'IN', '--no-install');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /application directory/);
  assert.deepEqual(readdirSync(dir), ['package.json']);
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), text);
});
