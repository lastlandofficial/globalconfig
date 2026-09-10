import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'glocon-frameworks-'));
const results = [];
async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
try {
  const archive = process.argv[2] ? resolve(process.argv[2]) : join(temp, JSON.parse((await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root })).stdout)[0].filename);
  for (const framework of (process.env.GLOCON_FRAMEWORK ? [process.env.GLOCON_FRAMEWORK] : ['vite', 'next'])) {
    const began = Date.now(); const dir = join(temp, framework);
    await cp(join(root, 'fixtures/check-apps', framework), dir, { recursive: true });
    await cp(join(root, 'examples/compliance/service.mjs'), join(dir, framework === 'next' ? 'app/compliance-service.js' : 'compliance-service.mjs'));
    await cp(join(root, 'examples/compliance/checkout.jsx'), join(dir, framework === 'next' ? 'app/checkout.jsx' : 'src/checkout.jsx'));
    const appPort = await port();
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    pkg.scripts.dev += ` --port ${appPort}`;
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
    await exec('npm', ['install', '--no-audit', '--no-fund', archive], { cwd: dir, timeout: 180000, maxBuffer: 4e6 });
    const cli = join(dir, 'node_modules/glocon/bin/glocon.mjs');
    // Exercise normal installation, browser installation, idempotency, and generated CI.
    await exec(process.execPath, [cli, 'init', '--ui', '--url', `http://127.0.0.1:${appPort}`], { cwd: dir, timeout: 180000, maxBuffer: 4e6 });
    await exec(process.execPath, [cli, 'init', '--ui'], { cwd: dir, timeout: 180000, maxBuffer: 4e6 });
    const configPath = join(dir, 'glocon.check.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.audit = { readySelector: 'main', timeout: 30000 };
    if (framework === 'vite') config.pages = ['/', '/settings'];
    else {
      assert.ok(config.pages.includes('/account'), 'Next static route discovery');
      config.pages = ['/', '/login', { path: '/account', auth: true }];
      config.auth = { storageState: '.glocon/auth.json', readySelector: '#signed-in', loginPath: '/login', setupCommand: 'node auth-setup.mjs' };
      await writeFile(join(dir, 'auth-setup.mjs'), `import { chromium } from 'playwright'; const browser = await chromium.launch(); try { const context = await browser.newContext(); const page = await context.newPage(); await page.goto(${JSON.stringify(config.baseURL + '/login')}); await page.getByRole('button', {name:'Use test account'}).click(); await page.locator('#signed-in').waitFor(); await context.storageState({path:'.glocon/auth.json'}); } finally { await browser.close(); }`);
    }
    const example = JSON.parse((await exec(process.execPath, [cli, 'check', '--example'], { cwd: dir })).stdout);
    example.path = '/scenarios';
    config.pages.push(example);
    config.pages.push({path:'/checkout',scenarios:[
      {name:'real invoice and partial credit',steps:[{action:'click',selector:'#quote'},{action:'expect',selector:'#finance-total',text:'2200'},{action:'click',selector:'#issue'},{action:'expect',selector:'#finance-status',text:'Invoice recorded'},{action:'click',selector:'#credit'},{action:'expect',selector:'#finance-status',text:'Credit recorded'},{action:'expect',selector:'#finance-total',text:'1100'}]},
      {name:'loading',mocks:[{path:'/api/compliance',method:'POST',responses:[{pending:true}]}],steps:[{action:'click',selector:'#quote'},{action:'expect',selector:'#finance-status',text:'Working…'},{action:'expect',selector:'#quote',state:'disabled'}]},
      {name:'retry',mocks:[{path:'/api/compliance',method:'POST',responses:[{status:503},{json:{message:'Quote ready',total:'2200'}}]}],steps:[{action:'click',selector:'#quote'},{action:'expect',selector:'#finance-retry',state:'visible'},{action:'click',selector:'#finance-retry'},{action:'expect',selector:'#finance-total',text:'2200'}]}
    ]});
    const expectedChecks = config.pages.reduce((count, page) => count + (page.scenarios?.length ?? 1), 0) * 2;
    await writeFile(configPath, JSON.stringify(config, null, 2));
    const execute = async () => {
      try { const r = await exec(process.execPath, [cli, 'check', '--json'], { cwd: dir, timeout: 180000, maxBuffer: 8e6, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } }); return { code: 0, report: JSON.parse(r.stdout), stderr: r.stderr }; }
      catch (error) { if (![1, 2].includes(error.code) || !error.stdout.trim().startsWith('{')) throw error; return { code: error.code, report: JSON.parse(error.stdout), stderr: error.stderr }; }
    };
    const first = await execute();
    assert.equal(first.report.summary.incomplete, 0, JSON.stringify(first.report.cases.map(c => ({page:c.page,status:c.status,message:c.message}))) + '\n' + first.stderr);
    assert.equal(first.report.summary.completed, expectedChecks);
    assert.equal(first.report.cases.filter(c => c.scenario).length, 14);
    assert.ok(first.report.cases.filter(c => c.scenario).every(c => c.steps.every(step => step.status === 'passed')));
    const firstMinutes = (Date.now() - began) / 60000;
    await exec(process.execPath, [cli, 'baseline', '--reason', 'Reviewed framework fixture findings'], { cwd: dir });
    assert.equal((await execute()).code, 0, 'Baseline should permit existing findings');
    if (framework === 'vite') {
      const file = join(dir, 'src/main.jsx'); await writeFile(file, (await readFile(file, 'utf8')).replace('<main>', '<main><button id="new-defect" />'));
    } else {
      const file = join(dir, 'app/page.js'); await writeFile(file, (await readFile(file, 'utf8')).replace('<main>', '<main><button id="new-defect" />'));
    }
    const regression = await execute(); assert.equal(regression.code, 1); assert.ok(regression.report.summary.new > 0);
    if (framework === 'next') {
      delete config.auth.setupCommand;
      await writeFile(join(dir, '.glocon/auth.json'), JSON.stringify({ cookies: [], origins: [] }));
      await writeFile(configPath, JSON.stringify(config));
      const expired = await execute(); assert.equal(expired.code, 2); assert.equal(expired.report.cases.filter(c => c.status === 'auth-required').length, 2);
    }
    assert.match(await readFile(join(dir, '.github/workflows/glocon.yml'), 'utf8'), /npm ci/);
    results.push({ framework, firstReportMinutes: Number(firstMinutes.toFixed(2)), checks: first.report.summary.completed, regressionDetected: true, interactionScenarios: 7, financialLifecycle: true, authValidated: framework === 'next' });
    console.log(`${framework}: setup/install, automatic startup, ${expectedChecks} checks, baseline, new regression${framework === 'next' ? ', browser login and expired-session detection' : ''} passed (${firstMinutes.toFixed(2)} minutes to first report).`);
  }
  await writeFile('/tmp/glocon-framework-results.json', JSON.stringify(results, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (process.env.GLOCON_KEEP_FRAMEWORKS === '1') console.log(`Retained framework fixtures: ${temp}`); else await rm(temp, { recursive: true, force: true }); }
