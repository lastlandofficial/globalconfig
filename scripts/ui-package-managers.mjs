import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const archive = resolve(process.argv[2] ?? `glocon-${version}.tgz`);
const managers = [
  { name: 'pnpm', bin: 'pnpm', prefix: [], add: ['add', archive, '--ignore-scripts'], check: ['exec', 'glocon', '--version'] },
  { name: 'bun', bin: 'npm', prefix: ['exec', '--yes', '--package=bun', '--', 'bun'], add: ['add', archive, '--ignore-scripts'], check: ['node_modules/glocon/bin/glocon.mjs', '--version'] },
  { name: 'yarn', bin: 'npm', prefix: ['exec', '--yes', '--package=@yarnpkg/cli-dist', '--', 'yarn'], add: ['add', `glocon@file:${archive}`], check: ['glocon', '--version'] },
];
const results = await Promise.allSettled(managers.map(async manager => {
  const directory = await mkdtemp(join(tmpdir(), `glocon-${manager.name}-`));
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `glocon-${manager.name}-consumer`, private: true, type: 'module' }));
    if (manager.name === 'yarn') await writeFile(join(directory, '.yarnrc.yml'), 'enableScripts: false\n');
    await exec(manager.bin, [...manager.prefix, ...manager.add], { cwd: directory, timeout: 120000 });
    const result = await exec(manager.bin, [...manager.prefix, ...manager.check], { cwd: directory, timeout: 30000 });
    if (!result.stdout.includes(version)) throw new Error(`${manager.name}: unexpected CLI version ${result.stdout}`);
    console.log(`${manager.name}: packed install and CLI passed`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
for (const result of results) if (result.status === 'rejected') { console.error(result.reason); process.exitCode = 1; }
