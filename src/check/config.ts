import { validateScenarios, type CheckScenario } from './scenarios';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PageAuditOptions } from '../ui/playwright/index';
import type { Severity } from '../ui/core/types';
import { auditSnapshot } from '../ui/core/engine';

export interface CheckPage { path: string; name?: string; readySelector?: string; auth?: boolean; scenarios?: CheckScenario[] }
export interface CheckViewport { name: string; width: number; height: number; colorScheme?: 'light' | 'dark' }
export interface CheckConfig {
  $schema?: string;
  version: 1;
  baseURL: string;
  pages: Array<string | CheckPage>;
  viewports: CheckViewport[];
  webServer?: { command: string; timeout?: number; reuseExistingServer?: boolean };
  auth?: { storageState: string; readySelector: string; loginPath?: string; setupCommand?: string };
  audit?: PageAuditOptions;
  failOn?: Severity | 'none';
  screenshots?: boolean;
}
export const configName = 'glocon.check.json';
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown option ${key}.`);
}
function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}
function boolean(value: unknown, label: string) { if (value !== undefined && typeof value !== 'boolean') throw new Error(`${label} must be boolean.`); }
function positive(value: unknown, label: string, max = 600000) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer from 1 to ${max}.`);
}
export function pageURL(path: string, baseURL: string): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Page paths must start with a single / and stay on the configured origin.');
  const url = new URL(path, baseURL);
  if (url.origin !== new URL(baseURL).origin || url.hash || url.username || url.password) throw new Error('Page paths must stay on the configured origin and omit fragments and credentials.');
  return url;
}
export function validateCheckConfig(input: unknown): CheckConfig {
  if (!record(input)) throw new Error('Check configuration must be an object.');
  keys(input, ['$schema', 'version', 'baseURL', 'pages', 'viewports', 'webServer', 'auth', 'audit', 'failOn', 'screenshots'], 'Check configuration');
  if (input.$schema !== undefined) string(input.$schema, '$schema');
  if (input.version !== 1) throw new Error('Check configuration version must be 1.');
  string(input.baseURL, 'baseURL');
  const base = new URL(input.baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('baseURL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  if (!Array.isArray(input.pages) || !input.pages.length || input.pages.length > 100) throw new Error('Configure 1–100 pages.');
  const paths = new Set<string>();
  for (const entry of input.pages) {
    const page: Record<string, unknown> = typeof entry === 'string' ? { path: entry } : record(entry) ? entry : {};
    keys(page, ['path', 'name', 'readySelector', 'auth', 'scenarios'], 'Page');
    string(page.path, 'Page path');
    const url = pageURL(page.path, input.baseURL);
    if (paths.has(url.href)) throw new Error(`Duplicate page path: ${url.pathname}`);
    paths.add(url.href);
    if (page.name !== undefined) string(page.name, 'Page name');
    if (page.readySelector !== undefined) string(page.readySelector, 'Page readySelector');
    boolean(page.auth, 'Page auth');
    if (page.scenarios !== undefined) validateScenarios(page.scenarios);
    if (page.auth && !input.auth) throw new Error('Protected pages require auth.storageState and auth.readySelector.');
  }
  if (!Array.isArray(input.viewports) || !input.viewports.length || input.viewports.length > 12) throw new Error('Configure 1–12 viewports.');
  const names = new Set<string>();
  for (const viewport of input.viewports) {
    if (!record(viewport)) throw new Error('Each viewport must be an object.');
    keys(viewport, ['name', 'width', 'height', 'colorScheme'], 'Viewport');
    string(viewport.name, 'Viewport name');
    if (names.has(viewport.name)) throw new Error('Viewport names must be unique.');
    names.add(viewport.name);
    positive(viewport.width, 'Viewport width', 4096); positive(viewport.height, 'Viewport height', 4096);
    if (viewport.colorScheme !== undefined && !['light', 'dark'].includes(String(viewport.colorScheme))) throw new Error('colorScheme must be light or dark.');
  }
  if (input.webServer !== undefined) {
    if (!record(input.webServer)) throw new Error('webServer must be an object.');
    keys(input.webServer, ['command', 'timeout', 'reuseExistingServer'], 'webServer');
    string(input.webServer.command, 'webServer.command');
    if (input.webServer.timeout !== undefined) positive(input.webServer.timeout, 'webServer.timeout');
    boolean(input.webServer.reuseExistingServer, 'webServer.reuseExistingServer');
  }
  if (input.auth !== undefined) {
    if (!record(input.auth)) throw new Error('auth must be an object.');
    keys(input.auth, ['storageState', 'readySelector', 'loginPath', 'setupCommand'], 'auth');
    string(input.auth.storageState, 'auth.storageState'); string(input.auth.readySelector, 'auth.readySelector');
    if (input.auth.loginPath !== undefined) { string(input.auth.loginPath, 'auth.loginPath'); pageURL(input.auth.loginPath, input.baseURL); }
    if (input.auth.setupCommand !== undefined) string(input.auth.setupCommand, 'auth.setupCommand');
  }
  if (input.audit !== undefined) {
    if (!record(input.audit)) throw new Error('audit must be an object.');
    keys(input.audit, ['rules', 'spacingScale', 'spacingTolerance', 'targetSize', 'suppressions', 'accessibility', 'readySelector', 'timeout', 'maxElements'], 'audit');
    boolean(input.audit.accessibility, 'audit.accessibility');
    if (input.audit.readySelector !== undefined) string(input.audit.readySelector, 'audit.readySelector');
    for (const key of ['timeout', 'maxElements']) if (input.audit[key] !== undefined) positive(input.audit[key], `audit.${key}`);
    auditSnapshot({ platform: 'web', viewport: { width: 1, height: 1 }, document: { scrollWidth: 1, clientWidth: 1 }, elements: [] }, input.audit);
  }
  if (input.failOn !== undefined && !['error', 'warning', 'info', 'none'].includes(String(input.failOn))) throw new Error('failOn must be error, warning, info, or none.');
  boolean(input.screenshots, 'screenshots');
  return input as unknown as CheckConfig;
}
export function defineCheckConfig(config: CheckConfig): CheckConfig { return validateCheckConfig(config); }
export async function readCheckConfig(dir: string, file = configName): Promise<CheckConfig> {
  try { return validateCheckConfig(JSON.parse(await readFile(resolve(dir, file), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No ${file} found. Run glocon init --ui in your application first.`);
    throw error;
  }
}
