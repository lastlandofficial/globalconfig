import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { CheckConfig } from './config';

export interface ManagedProcess { child: ChildProcess; done: Promise<number | null>; stop(): Promise<void> }
export function startCommand(command: string, dir: string): ManagedProcess {
  const child = spawn(command, { cwd: dir, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  // Keep stdout available for machine-readable reports; application logs go to stderr.
  child.stdout?.on('data', chunk => process.stderr.write(chunk));
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
  const done = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  void done.catch(() => {});
  let stopped: Promise<void> | undefined;
  return { child, done, stop() {
    return stopped ??= (async () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        if (child.exitCode === null) await new Promise<void>(resolve => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          killer.once('error', () => resolve()); killer.once('exit', () => resolve());
        });
      } else {
        const signal = (name: NodeJS.Signals) => { try { process.kill(-child.pid!, name); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; } };
        signal('SIGTERM');
        // Descendants can outlive the shell, so terminate the group even if the shell has exited.
        await delay(300); signal('SIGKILL');
      }
      await done.catch(() => {});
    })();
  } };
}
async function reachable(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1000)]) : AbortSignal.timeout(1000) });
    await response.body?.cancel();
    return response.status < 500;
  } catch { return false; }
}
export async function ensureServer(config: CheckConfig, dir: string, signal: AbortSignal): Promise<() => Promise<void>> {
  signal.throwIfAborted();
  if (await reachable(config.baseURL, signal)) {
    if (config.webServer?.reuseExistingServer === false) throw new Error('A server is already running at baseURL. Stop it or enable reuseExistingServer.');
    return async () => {};
  }
  signal.throwIfAborted();
  if (!config.webServer) throw new Error('No server is reachable at baseURL. Start your app or configure webServer.command.');
  const server = startCommand(config.webServer.command, dir);
  let exited = false;
  void server.done.then(() => { exited = true; }, () => { exited = true; });
  try {
    const until = Date.now() + (config.webServer.timeout ?? 60000);
    while (Date.now() < until) {
      signal.throwIfAborted();
      if (exited) throw new Error('The app start command exited before the server was ready. Check its logs and webServer.command.');
      if (await reachable(config.baseURL, signal)) return () => server.stop();
      await delay(200, undefined, { signal });
    }
    throw new Error('Timed out starting the app. Check baseURL, the start command, or webServer.timeout.');
  } catch (error) { await server.stop(); throw error; }
}
export async function runCommand(command: string, dir: string, signal: AbortSignal, timeout = 120000) {
  signal.throwIfAborted();
  const process = startCommand(command, dir);
  const timer = AbortSignal.timeout(timeout);
  const combined = AbortSignal.any([signal, timer]);
  const aborted = () => { void process.stop(); };
  combined.addEventListener('abort', aborted, { once: true });
  try {
    const code = await process.done;
    combined.throwIfAborted();
    if (code !== 0) throw new Error(`Setup command failed with exit code ${code}. Check the command's logs.`);
  } finally { combined.removeEventListener('abort', aborted); await process.stop(); }
}
