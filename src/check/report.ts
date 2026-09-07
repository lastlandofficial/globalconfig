import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AuditReport, Finding, Severity } from '../ui/core/types';
import type { CheckConfig, CheckViewport } from './config';
import { keys, record } from './config';

export interface CheckCase {
  id: string; page: string; name: string; viewport: CheckViewport;
  status: 'completed' | 'auth-required' | 'error';
  report?: AuditReport; screenshot?: string; message?: string;
}
export interface CheckIssue extends Finding { key: string; caseId: string; page: string; viewport: string; existing: boolean }
export interface CheckReport {
  schemaVersion: 1; createdAt: string; configHash: string; cases: CheckCase[];
  issues: CheckIssue[]; baseline: { tracked: number; resolved: number; expired: number };
  summary: { completed: number; incomplete: number; new: number; existing: number; groups: number };
  exitCode: 0 | 1 | 2;
}
export interface BaselineEntry { key: string; caseId: string; ruleId?: string; reason: string; reviewedOn: string; expires: string }
export interface Baseline { version: 1; entries: BaselineEntry[] }
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const configHash = (config: CheckConfig) => hash(canonical(config));
export const caseId = (path: string, viewport: CheckViewport, auth: boolean) => hash([path, viewport.name, viewport.width, viewport.height, viewport.colorScheme ?? 'light', auth]);
export function validDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date; }
export async function readBaseline(dir: string): Promise<Baseline> {
  let value: unknown;
  try { value = JSON.parse(await readFile(resolve(dir, 'glocon.baseline.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] }; throw error; }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.entries)) throw new Error('Invalid glocon.baseline.json. Expected version 1 and entries.');
  keys(value, ['version', 'entries'], 'Baseline');
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (!record(entry) || typeof entry.key !== 'string' || !/^[a-f0-9]{64}$/.test(entry.key) || typeof entry.caseId !== 'string' || !/^[a-f0-9]{64}$/.test(entry.caseId) || typeof entry.reason !== 'string' || !entry.reason.trim() || typeof entry.expires !== 'string' || !validDate(entry.expires) || typeof entry.reviewedOn !== 'string' || !validDate(entry.reviewedOn) || entry.expires <= entry.reviewedOn || seen.has(entry.key)) throw new Error('Baseline entries need unique keys, case IDs, review reasons, and valid review/expiry dates.');
    keys(entry, ['key', 'caseId', 'ruleId', 'reason', 'reviewedOn', 'expires'], 'Baseline entry');
    if (entry.ruleId !== undefined && (typeof entry.ruleId !== 'string' || !entry.ruleId.trim())) throw new Error('Baseline ruleId must be a non-empty string.');
    seen.add(entry.key);
  }
  return value as unknown as Baseline;
}
export function makeReport(config: CheckConfig, cases: CheckCase[], baseline: Baseline, now = new Date()): CheckReport {
  const today = now.toISOString().slice(0, 10);
  const active = new Map(baseline.entries.filter(e => e.expires > today && e.reviewedOn <= today).map(e => [e.key, e]));
  const issues: CheckIssue[] = [];
  for (const result of cases) for (const finding of result.report?.findings ?? []) {
    const key = hash([result.id, finding.ruleId, finding.target, finding.severity]);
    issues.push({ ...finding, key, caseId: result.id, page: result.name, viewport: result.viewport.name, existing: active.has(key) });
  }
  const completedIds = new Set(cases.filter(c => c.status === 'completed').map(c => c.id));
  const observed = new Set(issues.map(i => i.key));
  for (const result of cases) for (const { finding } of result.report?.suppressed ?? []) {
    for (const severity of ['error', 'warning', 'info']) observed.add(hash([result.id, finding.ruleId, finding.target, severity]));
  }
  const resolved = baseline.entries.filter(entry => {
    const result = cases.find(c => c.id === entry.caseId);
    return completedIds.has(entry.caseId) && entry.ruleId && result?.report?.coverage.rules.includes(entry.ruleId)
      && !result.report.coverage.limitations.some(limit => /^(Inline suppression|DOM collection truncated)/.test(limit))
      && !observed.has(entry.key);
  }).length;
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const threshold = config.failOn ?? 'error';
  const incomplete = cases.filter(c => c.status !== 'completed').length;
  const failing = threshold !== 'none' && issues.some(i => !i.existing && rank[i.severity] <= rank[threshold]);
  return {
    schemaVersion: 1, createdAt: now.toISOString(), configHash: configHash(config), cases, issues,
    baseline: { tracked: baseline.entries.length, resolved, expired: baseline.entries.filter(e => e.expires <= today || e.reviewedOn > today).length },
    summary: { completed: cases.length - incomplete, incomplete, new: issues.filter(i => !i.existing).length, existing: issues.filter(i => i.existing).length, groups: groupIssues(issues).size },
    exitCode: incomplete ? 2 : failing ? 1 : 0,
  };
}
export function groupIssues(issues: CheckIssue[]): Map<string, CheckIssue[]> {
  const groups = new Map<string, CheckIssue[]>();
  for (const issue of issues) {
    const key = hash([issue.ruleId, issue.target, issue.severity, issue.existing]);
    const group = groups.get(key) ?? []; group.push(issue); groups.set(key, group);
  }
  return groups;
}
export function formatCheckReport(report: CheckReport): string {
  const lines = [`glocon check — ${report.summary.completed}/${report.cases.length} page/viewport checks completed`, `${report.summary.new} new findings · ${report.summary.existing} existing · ${report.summary.incomplete} incomplete`];
  for (const group of groupIssues(report.issues).values()) {
    const issue = group[0]!;
    lines.push(`\n${issue.existing ? 'EXISTING' : 'NEW'} ${issue.severity.toUpperCase()} ${issue.ruleId} (${group.length} occurrence${group.length === 1 ? '' : 's'})`, `  ${issue.message}`, `  ${issue.target}`, ...group.map(i => `  ${i.page} · ${i.viewport}`), `  Fix: ${issue.suggestion}`);
  }
  for (const result of report.cases) if (result.status !== 'completed') lines.push(`\nINCOMPLETE ${result.name} · ${result.viewport.name}: ${result.message}`);
  if (report.baseline.tracked) lines.push(`\nBaseline: ${report.baseline.tracked} tracked · ${report.baseline.resolved} resolved in completed cases · ${report.baseline.expired} require renewed review`);
  const limitations = [...new Set(report.cases.flatMap(c => c.report?.coverage.limitations ?? []))];
  if (limitations.length) lines.push('\nCoverage limits:', ...limitations.map(l => `  ${l}`));
  return lines.join('\n');
}
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function renderCheckReport(report: CheckReport): string {
  const groups = [...groupIssues(report.issues).values()].sort((a, b) => Number(a[0]!.existing) - Number(b[0]!.existing));
  const cards = groups.map(group => {
    const issue = group[0]!;
    return `<details ${issue.existing ? '' : 'open'}><summary><span class="badge ${issue.existing ? 'existing' : 'new'}">${issue.existing ? 'Existing' : 'New'}</span> ${escape(issue.message)} <small>${group.length} occurrence(s)</small></summary><p><strong>${escape(issue.severity)} · ${escape(issue.ruleId)}</strong></p><pre>${escape(issue.target)}</pre><p>${escape(issue.suggestion)}</p>${issue.helpUrl && /^https?:\/\//.test(issue.helpUrl) ? `<p><a href="${escape(issue.helpUrl)}" rel="noreferrer">Supporting guidance</a></p>` : ''}<ul>${group.map(i => {
      const result = report.cases.find(c => c.id === i.caseId);
      return `<li>${escape(i.page)} · ${escape(i.viewport)}${result?.screenshot && /^screenshots\/[a-f0-9]{64}\.png$/.test(result.screenshot) ? ` — <a href="${escape(result.screenshot)}">View highlighted page</a>` : ''}<details><summary>Measured evidence</summary><pre>${escape(JSON.stringify(i.evidence, null, 2))}</pre></details></li>`;
    }).join('')}</ul></details>`;
  }).join('');
  const cases = report.cases.map(c => `<tr><td>${escape(c.name)}</td><td>${escape(c.viewport.name)} (${c.viewport.width} × ${c.viewport.height})</td><td>${escape(c.status)}</td><td>${escape(c.message ?? `${c.report?.findings.length ?? 0} findings`)}</td></tr>`).join('');
  const limits = [...new Set(report.cases.flatMap(c => c.report?.coverage.limitations ?? []))];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'"><title>glocon check report</title><style>
  :root{font:16px/1.6 system-ui;color:#17233b;background:#f3f5f8}body{max-width:1000px;margin:48px auto;padding:0 24px}h1{font-size:2.5rem;letter-spacing:-.05em;margin-bottom:0}p{max-width:80ch}small{font-size:.8rem;color:#46536b}details{background:white;border:1px solid #d6dce6;border-radius:8px;padding:16px;margin:12px 0}summary{cursor:pointer;font-weight:600}details details{padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:12px}a{color:#174aac}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #d6dce6;padding:10px;overflow-wrap:anywhere}.table{overflow:auto}.badge{padding:3px 8px;border-radius:4px;font-size:.75rem}.new{background:#ffe9d5;color:#76370b}.existing{background:#e8edf5;color:#384965}.stats{font-size:1.2rem}.muted{color:#46536b}@media(max-width:600px){body{margin:20px auto;padding:0 12px}h1{font-size:2rem}details{padding:12px}}
  </style></head><body><main><p class="muted">GLOBALCONFIG / UI CHECKS</p><h1>Your app, checked.</h1><p class="stats">${report.summary.new} new findings · ${report.summary.existing} existing · ${report.summary.incomplete} incomplete checks</p><p>${escape(report.createdAt)} · ${report.summary.completed}/${report.cases.length} page/viewport checks completed</p><h2>Findings</h2>${cards || '<p>No findings in completed checks.</p>'}<h2>Coverage</h2><div class="table"><table><thead><tr><th>Page</th><th>Screen</th><th>Status</th><th>Details</th></tr></thead><tbody>${cases}</tbody></table></div><p>Baseline: ${report.baseline.tracked} tracked, ${report.baseline.resolved} resolved in completed cases, ${report.baseline.expired} require renewed review.</p><h2>What this run covered</h2><ul>${limits.map(l => `<li>${escape(l)}</li>`).join('')}</ul><p>Reports may contain application content in screenshots. Keep test sessions and reports local unless you choose to share them.</p></main></body></html>`;
}
export async function writeJSON(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}
export async function saveBaseline(dir: string, config: CheckConfig, reason: string, expires?: string) {
  if (!reason.trim()) throw new Error('Review the report and provide --reason before accepting a baseline.');
  const report = JSON.parse(await readFile(resolve(dir, '.glocon/report.json'), 'utf8')) as CheckReport;
  const today = new Date().toISOString().slice(0, 10);
  const expiry = expires ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  if (!validDate(expiry) || expiry <= today) throw new Error('--expires must be a future YYYY-MM-DD date.');
  if (report.schemaVersion !== 1 || report.configHash !== configHash(config) || report.summary.incomplete || report.cases.length !== config.pages.length * config.viewports.length || report.cases.some(c => c.status !== 'completed') || !Array.isArray(report.issues)) throw new Error('Run glocon check successfully across every configured page and viewport before accepting a baseline.');
  if (report.createdAt.slice(0, 10) !== today) throw new Error('Run glocon check again today before accepting a baseline.');
  const entries = [...new Map(report.issues.map(i => [i.key, { key: i.key, caseId: i.caseId, ruleId: i.ruleId, reason, reviewedOn: today, expires: expiry }])).values()];
  await writeJSON(resolve(dir, 'glocon.baseline.json'), { version: 1, entries });
  return entries.length;
}
