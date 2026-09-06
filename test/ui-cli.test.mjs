import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const cli = resolve('bin/glocon.mjs');
const run = (cwd, ...args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
test('UI setup works without country setup and never overwrites either configuration', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'glocon-ui-init-'));
  try {
    writeFileSync(join(cwd, 'glocon.config.json'), '{"country":"JP"}\n');
    run(cwd, 'ui', 'init');
    const file = join(cwd, 'glocon.ui.json');
    const original = readFileSync(file, 'utf8');
    assert.equal(JSON.parse(original).accessibility, true);
    assert.equal(readFileSync(join(cwd, 'glocon.config.json'), 'utf8'), '{"country":"JP"}\n');
    assert.equal(existsSync(join(cwd, 'globalconfig.js')), false);
    const retry = spawnSync(process.execPath, [cli, 'ui', 'init'], { cwd, encoding: 'utf8' });
    assert.equal(retry.status, 2);
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
test('UI command aliases agree and doctor detects frameworks without country configuration', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'glocon-ui-doctor-'));
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { next: '*', react: '*', expo: '*' } }));
    const doctor = JSON.parse(run(cwd, 'doctor', '--json'));
    assert.deepEqual(doctor.frameworks, ['Next.js', 'Expo', 'React']);
    const rules = JSON.parse(run(cwd, 'rules', '--json'));
    assert.ok(rules.some(rule => rule.id === 'layout/overflow'));
    assert.deepEqual(JSON.parse(run(cwd, 'ui', 'rules', '--json')), rules);
    assert.equal(run(cwd, 'ui', '--version'), run(cwd, '--version'));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
test('UI audit input failures retain a distinct exit code', () => {
  for (const args of [['audit', 'file:///tmp/app.html'], ['ui', 'unknown']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /glocon:/);
  }
});
