import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'globalconfig-managers-'));
try {
  // Optional argument verifies the published GitHub URL instead of a locally packed tarball.
  const archive = process.argv[2] ?? join(temp, JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }))[0].filename);
  for (const manager of ['npm', 'pnpm', 'yarn', 'bun']) {
    const cwd = join(temp, manager);
    mkdirSync(cwd);
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: `globalconfig-${manager}-consumer`, private: true, version: '1.0.0', type: 'module' }));
    const args = manager === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive] : manager === 'yarn' ? ['add', '--ignore-scripts', '--non-interactive', archive] : ['add', '--ignore-scripts', archive];
    execFileSync(manager, args, { cwd, stdio: 'pipe' });
    const smoke = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createGlobalConfig, convertLocalTime } from 'globalconfig';
const require = createRequire(import.meta.url);
assert.equal(createGlobalConfig({ country: 'JP' }).tax.calculate({ country: 'JP', amount: '1000', category: 'standard' }).gross, '1100');
assert.equal(require('globalconfig/currency').toMinorUnits('1.005', 'USD'), 101n);
assert.equal(convertLocalTime('2026-09-01T09:00', { from: 'America/New_York', to: 'JP' }).local, '2026-09-01T22:00:00');
for (const entry of ['countries', 'currency', 'time', 'tax', 'laws']) {
  assert.ok(Object.keys(await import('globalconfig/' + entry)).length);
  assert.ok(Object.keys(require('globalconfig/' + entry)).length);
}`;
    writeFileSync(join(cwd, 'smoke.mjs'), smoke);
    execFileSync(manager === 'bun' ? 'bun' : process.execPath, ['smoke.mjs'], { cwd, stdio: 'inherit' });
    console.log(`${manager}: clean install with scripts disabled, ESM/CommonJS, and runtime smoke passed`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
