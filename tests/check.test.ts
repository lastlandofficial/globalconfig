import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCheckConfig, type CheckConfig } from '../src/check/config';
import { makeReport, caseId, hash, renderCheckReport, readBaseline, saveBaseline, writeJSON, type CheckCase, type Baseline } from '../src/check/report';
import { setupProject } from '../src/check/setup';
import { auditSnapshot } from '../src/ui';
const config: CheckConfig = { version: 1, baseURL: 'http://localhost:3000', pages: ['/'], viewports: [{ name: 'phone', width: 390, height: 844 }] };
const findingReport = auditSnapshot({ platform: 'web', viewport: { width: 390, height: 844 }, document: { scrollWidth: 800, clientWidth: 390 }, elements: [] });
const completed = (): CheckCase => ({ id: caseId('/', config.viewports[0]!, false), page: '/', name: '/', viewport: config.viewports[0]!, status: 'completed', report: structuredClone(findingReport) });

describe('project config', () => {
  it('rejects unsafe or ambiguous URL scopes and unknown options', () => {
    for (const change of [{ pages: ['//other.example/'] }, { pages: ['/\\other.example/'] }, { pages: ['/#fragment'] }, { pages: ['/', '/'] }, { pages: [] }, { baseURL: 'https://user:secret@example.com' }, { baseURL: 'https://example.com/path' }, { typo: true }]) expect(() => validateCheckConfig({ ...config, ...change })).toThrow();
  });
  it('requires explicit authentication verification and valid matrices', () => {
    expect(() => validateCheckConfig({ ...config, pages: [{ path: '/', auth: true }] })).toThrow('Protected');
    expect(() => validateCheckConfig({ ...config, auth: { storageState: 'auth.json' } })).toThrow('readySelector');
    for (const viewports of [[], [{ name: 'phone', width: -1, height: 800 }], [...config.viewports, ...config.viewports]]) expect(() => validateCheckConfig({ ...config, viewports })).toThrow();
    expect(validateCheckConfig({ ...config, auth: { storageState: '.glocon/auth.json', readySelector: '#signed-in' }, pages: [{ path: '/account', auth: true }] }).pages).toHaveLength(1);
  });
});
describe('reviewed baselines and reports', () => {
  it('tracks existing issues, expiry, severity escalation, and viewport changes separately', () => {
    const now = new Date('2026-09-07T12:00:00Z');
    const result = completed();
    const first = makeReport(config, [result], { version: 1, entries: [] }, now);
    const issue = first.issues[0]!;
    const baseline: Baseline = { version: 1, entries: [{ key: issue.key, caseId: issue.caseId, reason: 'Fix tracked in UI-12', reviewedOn: '2026-09-07', expires: '2026-10-07' }] };
    expect(makeReport(config, [result], baseline, now).summary.existing).toBe(1);
    expect(makeReport(config, [result], baseline, new Date('2026-10-07')).summary.new).toBe(1);
    result.report!.findings[0]!.severity = 'error';
    expect(makeReport(config, [result], baseline, now).summary.new).toBe(1);
    expect(caseId('/', { ...config.viewports[0]!, width: 320 }, false)).not.toBe(result.id);
    expect(caseId('/', config.viewports[0]!, true)).not.toBe(result.id);
  });
  it('incomplete cases cannot pass even with failOn none or resolve old baseline entries', () => {
    const result = completed();
    const issue = makeReport(config, [result], { version: 1, entries: [] }).issues[0]!;
    const baseline: Baseline = { version: 1, entries: [{ key: issue.key, caseId: issue.caseId, reason: 'Reviewed', reviewedOn: '2026-09-01', expires: '2099-01-01' }] };
    delete result.report; result.status = 'auth-required';
    const report = makeReport({ ...config, failOn: 'none' }, [result], baseline);
    expect(report.exitCode).toBe(2); expect(report.baseline.resolved).toBe(0);
  });
  it('does not call suppressed findings or disabled rules resolved', () => {
    const result = completed();
    const issue = makeReport(config, [result], { version: 1, entries: [] }).issues[0]!;
    const baseline: Baseline = { version: 1, entries: [{ key: issue.key, caseId: issue.caseId, ruleId: issue.ruleId, reason: 'Reviewed', reviewedOn: '2026-09-01', expires: '2099-01-01' }] };
    const finding = result.report!.findings[0]!;
    result.report!.findings = [];
    result.report!.suppressed = [{ finding, reason: 'Exception' }];
    expect(makeReport(config, [result], baseline).baseline.resolved).toBe(0);
    result.report!.suppressed = [];
    const rules = result.report!.coverage.rules;
    result.report!.coverage.rules = [];
    expect(makeReport(config, [result], baseline).baseline.resolved).toBe(0);
    result.report!.coverage.rules = rules;
    expect(makeReport(config, [result], baseline).baseline.resolved).toBe(1);
    result.report!.coverage.limitations.push('Inline suppression at #form: layout/overflow (custom rules only).');
    expect(makeReport(config, [result], baseline).baseline.resolved).toBe(0);
    result.report!.coverage.limitations = ['DOM collection truncated to 10 of 100 elements.'];
    expect(makeReport(config, [result], baseline).baseline.resolved).toBe(0);
  });
  it('groups occurrences and escapes page-controlled HTML and links', () => {
    const a = completed(); const b = completed(); b.id = hash('desktop'); b.viewport = { name: 'desktop', width: 1280, height: 800 };
    a.report!.findings[0]!.message = '<script>alert(1)</script>';
    a.report!.findings[0]!.helpUrl = 'javascript:alert(1)';
    const report = makeReport(config, [a, b], { version: 1, entries: [] });
    expect(report.summary.groups).toBe(1);
    const html = renderCheckReport(report);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:'); expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('2 occurrence(s)');
  });
  it('accepts only a current, complete reviewed run matching the configuration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glocon-baseline-test-'));
    try {
      const report = makeReport(config, [completed()], { version: 1, entries: [] });
      await writeJSON(join(dir, '.glocon/report.json'), report);
      await expect(saveBaseline(dir, config, '')).rejects.toThrow('reason');
      await expect(saveBaseline(dir, { ...config, pages: ['/other'] }, 'Reviewed')).rejects.toThrow('every configured');
      await expect(saveBaseline(dir, config, 'Reviewed', '2026-02-30')).rejects.toThrow('future');
      expect(await saveBaseline(dir, config, 'Tracked in UI-1')).toBe(1);
      expect((await readBaseline(dir)).entries[0]!.reason).toBe('Tracked in UI-1');
      report.summary.incomplete = 1;
      await writeJSON(join(dir, '.glocon/report.json'), report);
      await expect(saveBaseline(dir, config, 'Reviewed')).rejects.toThrow('every configured');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
describe('framework setup', () => {
  it('discovers static Next routes, preserves application edits, and safely repeats', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glocon-setup-test-'));
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'application', packageManager: 'pnpm@10.0.0', dependencies: { next: '16', glocon: '^0.3.0' }, scripts: { dev: 'next dev --port 3322', 'glocon:check': 'echo custom' } }));
      for (const file of ['app/page.tsx', 'app/(public)/about/page.tsx', 'app/orders/[id]/page.tsx', 'app/api/route.ts', 'app/@slot/page.tsx']) {
        await mkdir(join(dir, file, '..'), { recursive: true }); await writeFile(join(dir, file), '');
      }
      await writeFile(join(dir, 'playwright.config.ts'), '// existing tests');
      await setupProject({ dir, version: '0.4.0', noInstall: true });
      const saved = JSON.parse(await readFile(join(dir, 'glocon.check.json'), 'utf8'));
      expect(saved.pages).toEqual(['/', '/about']); expect(saved.baseURL).toBe('http://localhost:3322');
      expect(saved.webServer.command).toBe('pnpm run dev');
      saved.pages = ['/custom']; await writeFile(join(dir, 'glocon.check.json'), JSON.stringify(saved));
      await writeFile(join(dir, '.github/workflows/glocon.yml'), '# developer changes\n');
      await setupProject({ dir, version: '0.4.0', noInstall: true });
      expect(JSON.parse(await readFile(join(dir, 'glocon.check.json'), 'utf8')).pages).toEqual(['/custom']);
      expect(await readFile(join(dir, '.github/workflows/glocon.yml'), 'utf8')).toBe('# developer changes\n');
      expect(await readFile(join(dir, 'playwright.config.ts'), 'utf8')).toBe('// existing tests');
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts['glocon:check']).toBe('echo custom'); expect(pkg.dependencies.glocon).toBe('^0.4.0');
      expect((await readFile(join(dir, '.gitignore'), 'utf8')).match(/\/\.glocon\//g)).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects ambiguous package managers before touching files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glocon-setup-test-'));
    try {
      await writeFile(join(dir, 'package.json'), '{"dependencies":{"vite":"*"},"scripts":{"dev":"vite"}}');
      await writeFile(join(dir, 'package-lock.json'), '{}'); await writeFile(join(dir, 'pnpm-lock.yaml'), '');
      await expect(setupProject({ dir, version: '0.4.0', noInstall: true })).rejects.toThrow('Multiple lockfiles');
      await expect(readFile(join(dir, 'glocon.check.json'))).rejects.toThrow();
      await setupProject({ dir, version: '0.4.0', manager: 'npm', noInstall: true, noCI: true });
      expect(JSON.parse(await readFile(join(dir, 'glocon.check.json'), 'utf8')).baseURL).toBe('http://localhost:5173');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
