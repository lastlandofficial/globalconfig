import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runChecks, type CheckConfig } from '../src/check';
const exec = promisify(execFile);
const cli = resolve('bin/glocon.mjs');
const serverSource = `import { createServer } from 'node:http';
const port = Number(process.argv[2]);
const html = body => '<!doctype html><html lang="en"><head><title>Test application</title><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;color:#111;background:#fff;margin:20px}button,input{min-height:44px;padding:8px}main{max-width:100%}</style></head><body><main>'+body+'</main></body></html>';
createServer((req,res) => {
 const url = new URL(req.url,'http://localhost');
 if(url.pathname === '/session') { res.setHeader('set-cookie','test-session=valid; Path=/; HttpOnly; SameSite=Lax'); res.end('ok'); return; }
 if(url.pathname === '/private' && !req.headers.cookie?.includes('test-session=valid')) { res.writeHead(302,{location:'/login'}).end(); return; }
 if(url.pathname === '/fail') { res.writeHead(500).end('fail'); return; }
 res.setHeader('content-type','text/html');
 res.end(html(url.pathname === '/broken' ? '<h1>Broken form</h1><button id="unlabelled"></button>' : url.pathname === '/private' ? '<h1 id="signed-in">Account</h1><p>Your private project</p>' : url.pathname === '/login' ? '<h1>Sign in</h1>' : '<h1>Welcome</h1><button>Continue</button>'));
}).listen(port,'127.0.0.1',()=>console.log('fixture server ready'));
`;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'glocon-runner-test-'));
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No port');
  const port = address.port; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await writeFile(join(dir, 'package.json'), '{"name":"fixture-app","type":"module"}');
  await writeFile(join(dir, 'server.mjs'), serverSource);
  await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
  const config: CheckConfig = { version: 1, baseURL: `http://127.0.0.1:${port}`, pages: ['/', '/broken'], viewports: [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }], webServer: { command: `node server.mjs ${port}`, timeout: 10000 }, audit: { timeout: 5000 }, screenshots: true };
  return { dir, config, port };
}
async function command(dir: string, ...args: string[]) {
  try { return { ...(await exec(process.execPath, [cli, ...args], { cwd: dir, timeout: 40000 })), code: 0 }; }
  catch (e) { const error = e as { stdout: string; stderr: string; code: number }; return error; }
}
test('installed-command flow starts/stops the app, aggregates screens, highlights findings and baselines regressions', async ({ page }) => {
  test.setTimeout(60000);
  const { dir, config } = await fixture();
  try {
    await writeFile(join(dir, 'glocon.check.json'), JSON.stringify(config));
    const first = await command(dir, 'check', '--json');
    expect(first.code, first.stderr).toBe(1);
    const report = JSON.parse(first.stdout);
    expect(report.summary.completed).toBe(4); expect(report.summary.incomplete).toBe(0);
    expect(report.summary.new).toBeGreaterThan(0); expect(report.summary.groups).toBeLessThan(report.summary.new);
    const screenshot = report.cases.find((c: { screenshot?: string }) => c.screenshot)?.screenshot;
    expect((await readFile(join(dir, '.glocon', screenshot))).length).toBeGreaterThan(100);
    await page.goto(`file://${join(dir, '.glocon/report.html')}`);
    await expect(page.getByRole('heading', { name: 'Your app, checked.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View highlighted page' }).first()).toBeVisible();
    await expect(fetch(config.baseURL)).rejects.toThrow();
    const baseline = await command(dir, 'baseline', '--reason', 'Reviewed fixture issue tracked in UI-1'); expect(baseline.code, baseline.stderr).toBe(0);
    const second = await command(dir, 'check', '--json'); expect(second.code, second.stderr).toBe(0);
    const repeated = JSON.parse(second.stdout); expect(repeated.summary.new).toBe(0); expect(repeated.summary.existing).toBeGreaterThan(0);
    await writeFile(join(dir, 'server.mjs'), serverSource.replace('<button id="unlabelled"></button>', '<button id="unlabelled"></button><img id="new-image" src="missing.png">'));
    const regression = await command(dir, 'check', '--json'); expect(regression.code).toBe(1); expect(JSON.parse(regression.stdout).summary.new).toBeGreaterThan(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('protected pages require a verified test session, and reuse an existing Playwright setup command', async () => {
  test.setTimeout(45000);
  const { dir, config, port } = await fixture();
  try {
    config.pages = ['/', { path: '/private', auth: true }]; config.viewports = [config.viewports[0]!];
    config.auth = { storageState: '.glocon/auth.json', readySelector: '#signed-in', loginPath: '/login' };
    await mkdir(join(dir, '.glocon'));
    await writeFile(join(dir, '.glocon/auth.json'), JSON.stringify({ cookies: [], origins: [] }));
    let result = await runChecks(config, { dir });
    expect(result.exitCode).toBe(2); expect(result.cases[0]!.status).toBe('completed'); expect(result.cases[1]!.status).toBe('auth-required');
    await writeFile(join(dir, 'auth-setup.mjs'), `import { request } from 'playwright'; const api=await request.newContext(); await api.get('http://127.0.0.1:${port}/session'); await api.storageState({path:'.glocon/auth.json'}); await api.dispose();`);
    config.auth.setupCommand = 'node auth-setup.mjs';
    result = await runChecks(config, { dir }); expect(result.exitCode).toBe(0); expect(result.summary.completed).toBe(2);
    config.auth.setupCommand = 'node -e "process.exit(1)"';
    result = await runChecks(config, { dir }); expect(result.exitCode).toBe(2); expect(result.cases[1]!.status).toBe('auth-required');
    expect(JSON.stringify(result)).not.toContain('test-session=valid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('startup failure invalidates old results, and interrupted runs stop the owned server', async () => {
  const { dir, config } = await fixture();
  try {
    config.pages = ['/']; config.viewports = [config.viewports[0]!]; config.screenshots = false;
    expect((await runChecks(config, { dir })).exitCode).toBe(0);
    config.webServer!.command = 'node -e "process.exit(1)"';
    const failed = await runChecks(config, { dir }); expect(failed.exitCode).toBe(2);
    expect(JSON.parse(await readFile(join(dir, '.glocon/report.json'), 'utf8')).summary.incomplete).toBe(1);
    config.webServer!.command = 'node -e "setInterval(()=>{},1000)"';
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 500);
    try { expect((await runChecks(config, { dir, signal: controller.signal })).exitCode).toBe(2); }
    finally { clearTimeout(timer); }
    await expect(fetch(config.baseURL)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('reusing an existing server does not terminate it, and missing routes cannot be baselined as passes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glocon-existing-server-'));
  try {
    await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    const config: CheckConfig = { version: 1, baseURL: 'http://127.0.0.1:4179', pages: ['/fixtures/healthy.html', '/missing-route'], viewports: [{ name: 'desktop', width: 1280, height: 800 }], failOn: 'none' };
    const report = await runChecks(config, { dir }); expect(report.exitCode).toBe(2); expect(report.summary.completed).toBe(1);
    expect((await fetch('http://127.0.0.1:4179/fixtures/healthy.html')).ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
