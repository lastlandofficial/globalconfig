import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  open,
  unlink,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Browser, BrowserContext, Page } from "playwright";
import { auditPage } from "../ui/playwright/index";
import { ensureServer, runCommand } from "./process";
import { resolvePlaywright } from "./setup";
import { pageURL, validateCheckConfig, type CheckConfig } from "./config";
import { expectedDestination, sameDestination } from "./destination";
import {
  makeReport,
  readBaseline,
  writeJSON,
  renderCheckReport,
  caseId,
  type CheckCase,
  type CheckReport,
  type Baseline,
} from "./report";

import { installMocks, runSteps } from "./scenarios";

class AuthRequired extends Error {}
const safeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /https?:\/\/[^\s"'<>]+/g,
    (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[URL]";
      }
    },
  );
function signalScope(external?: AbortSignal, timeout?: number) {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Run interrupted."));
  const timer =
    timeout === undefined
      ? undefined
      : setTimeout(
          () =>
            controller.abort(
              new Error(
                "Run timed out. Increase runTimeout to allow more time.",
              ),
            ),
          timeout,
        );
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  external?.addEventListener("abort", stop, { once: true });
  if (external?.aborted) stop();
  return {
    signal: controller.signal,
    dispose() {
      if (timer) clearTimeout(timer);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      external?.removeEventListener("abort", stop);
    },
  };
}
async function capture(page: Page, targets: string[], file: string) {
  await page.evaluate((selectors) => {
    for (const target of selectors) {
      let selector = target;
      try {
        const parsed: unknown = JSON.parse(target);
        if (Array.isArray(parsed)) {
          if (parsed.length !== 1 || typeof parsed[0] !== "string") continue;
          selector = parsed[0];
        }
      } catch {}
      try {
        for (const element of document.querySelectorAll(selector)) {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const marker = document.createElement("div");
          marker.setAttribute("data-glocon-highlight", "");
          Object.assign(marker.style, {
            position: "absolute",
            left: `${rect.left + scrollX}px`,
            top: `${rect.top + scrollY}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            outline: "3px solid #dc2626",
            outlineOffset: "-3px",
            pointerEvents: "none",
            zIndex: "2147483647",
            boxSizing: "border-box",
          });
          document.documentElement.append(marker);
        }
      } catch {}
    }
  }, targets);
  try {
    await page.screenshot({
      path: file,
      timeout: 10000,
      animations: "disabled",
      mask: [page.locator('input, textarea, [contenteditable="true"]')],
    });
  } finally {
    await page
      .evaluate(() => {
        document
          .querySelectorAll("[data-glocon-highlight]")
          .forEach((e) => e.remove());
      })
      .catch(() => {});
  }
}
async function timed<T>(
  task: Promise<T>,
  ms: number,
  signal: AbortSignal,
  cancel: () => Promise<unknown>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        const fail = (error: Error) => {
          reject(error);
          void cancel().catch(() => {});
        };
        timer = setTimeout(
          () =>
            fail(
              new Error(
                "Page check timed out. Set audit.timeout or a page readySelector for slow apps.",
              ),
            ),
          ms,
        );
        abort = () =>
          fail(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("Run interrupted."),
          );
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export interface CheckProgress {
  completed: number;
  total: number;
  caseId: string;
  status: CheckCase["status"];
}
export interface RunCheckOptions {
  dir?: string;
  signal?: AbortSignal;
  /** Called as cases finish, including failures. Report order remains configuration order. */
  onProgress?: (progress: CheckProgress) => void;
}
async function acquireRunLock(output: string): Promise<() => Promise<void>> {
  await mkdir(output, { recursive: true });
  const file = resolve(output, "check.lock");
  const owner =
    JSON.stringify({ pid: process.pid, token: randomUUID() }) + "\n";
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Another glocon check owns .glocon/check.lock. Wait for it to finish. If its process was terminated, verify no check is running before removing this stale lock.",
      );
    throw error;
  }
  try {
    await handle.writeFile(owner);
  } catch (error) {
    await handle.close();
    await unlink(file).catch(() => {});
    throw error;
  }
  await handle.close();
  return async () => {
    // Do not remove a replacement lock, for example after manual stale-lock recovery.
    if ((await readFile(file, "utf8").catch(() => undefined)) === owner)
      await unlink(file).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
  };
}
export async function runChecks(
  config: CheckConfig,
  options: RunCheckOptions = {},
): Promise<CheckReport> {
  config = validateCheckConfig(config);
  const dir = resolve(options.dir ?? ".");
  const output = resolve(dir, ".glocon");
  const releaseLock = await acquireRunLock(output);
  const scope = signalScope(options.signal, config.runTimeout);
  // Each active isolated case installs one cancellation listener on this run's signal.
  setMaxListeners((config.concurrency ?? 2) + 5, scope.signal);
  const runDeadline =
    config.runTimeout === undefined
      ? undefined
      : Date.now() + config.runTimeout;
  const pages = config.pages.map((p) =>
    typeof p === "string" ? { path: p } : p,
  );
  const plans = pages.flatMap((entry) =>
    (entry.scenarios ?? [undefined]).flatMap((scenario) =>
      config.viewports.map((viewport) => ({ entry, scenario, viewport })),
    ),
  );
  const cases: CheckCase[] = plans.map(({ entry, scenario, viewport }) => ({
    id: caseId(
      entry.path,
      viewport,
      entry.auth ?? false,
      scenario,
      entry.expectedURL,
    ),
    page: pageURL(entry.path, config.baseURL).pathname,
    name: `${entry.name ?? pageURL(entry.path, config.baseURL).pathname}${scenario ? ` / ${scenario.name}` : ""}`,
    viewport,
    status: "error",
    message: "Not run.",
    ...(scenario
      ? {
          scenario: scenario.name,
          steps: scenario.steps.map((step) => ({
            action: step.action,
            selector: step.selector,
            status: "not-run" as const,
          })),
        }
      : {}),
  }));
  const finished = new Set<number>();
  let progressFailed = false;
  const progress = (index: number) => {
    if (finished.has(index)) return;
    finished.add(index);
    try {
      options.onProgress?.({
        completed: finished.size,
        total: cases.length,
        caseId: cases[index]!.id,
        status: cases[index]!.status,
      });
    } catch {
      if (!progressFailed)
        process.stderr.write(
          "glocon: Progress callback failed; checks continue.\n",
        );
      progressFailed = true;
    }
  };
  let baseline: Baseline = { version: 1, entries: [] };
  let stopServer: () => Promise<void> = async () => {};
  let browser: Browser | undefined;
  const closeBrowser = () => {
    void browser?.close().catch(() => {});
  };
  scope.signal.addEventListener("abort", closeBrowser, { once: true });
  try {
    try {
      // Invalidate both previous artifacts before startup/authentication can fail.
      const pending = makeReport(config, cases, baseline);
      await writeJSON(resolve(output, "report.json"), pending);
      await writeFile(
        resolve(output, "report.html"),
        renderCheckReport(pending),
        { mode: 0o600 },
      );
      await rm(resolve(output, "screenshots"), {
        recursive: true,
        force: true,
      });
      await mkdir(resolve(output, "screenshots"), {
        recursive: true,
        mode: 0o700,
      });
      baseline = await readBaseline(dir);
      const playwright = resolvePlaywright(dir);
      stopServer = await ensureServer(config, dir, scope.signal);
      let authError: string | undefined;
      let storageState:
        Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
      if (config.auth && pages.some((p) => p.auth)) {
        try {
          if (config.auth.setupCommand)
            await runCommand(config.auth.setupCommand, dir, scope.signal);
          storageState = JSON.parse(
            await readFile(resolve(dir, config.auth.storageState), "utf8"),
          );
          if (
            !storageState ||
            !Array.isArray(storageState.cookies) ||
            !Array.isArray(storageState.origins)
          )
            throw new Error("Invalid storage state");
        } catch {
          authError =
            "Test login is unavailable. Run glocon login or fix auth.setupCommand and auth.storageState.";
        }
      }
      scope.signal.throwIfAborted();
      browser = await playwright.chromium.launch({
        timeout: Math.max(
          1,
          Math.min(
            runDeadline === undefined ? 30000 : runDeadline - Date.now(),
            30000,
          ),
        ),
      });
      scope.signal.throwIfAborted();
      const runCase = async (index: number) => {
        const { entry, scenario, viewport } = plans[index]!;
        const result = cases[index]!;
        if (scope.signal.aborted) {
          result.message = safeError(scope.signal.reason);
          progress(index);
          return;
        }
        if (entry.auth && authError) {
          result.status = "auth-required";
          result.message = authError;
          progress(index);
          return;
        }
        const timeout = config.audit?.timeout ?? 30000;
        let context: BrowserContext | undefined;
        let cancelled = false;
        const check = async () => {
          context = await browser!.newContext({
            ...(scenario?.mocks?.length
              ? { serviceWorkers: "block" as const }
              : {}),
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme: viewport.colorScheme ?? "light",
            ...(entry.auth && storageState
              ? { storageState: structuredClone(storageState) }
              : {}),
          });
          if (cancelled || scope.signal.aborted) {
            await context.close();
            throw new Error("Run interrupted.");
          }
          if (scenario)
            result.mocks = await installMocks(
              context,
              scenario,
              config.baseURL,
            );
          const page = await context.newPage();
          page.setDefaultTimeout(timeout);
          const requested = pageURL(entry.path, config.baseURL);
          const initial = expectedDestination(
            entry.expectedURL ?? requested.href,
            config.baseURL,
          );
          const final = expectedDestination(
            scenario?.expectedURL ?? initial.href,
            config.baseURL,
          );
          const verifyDestination = (expected: URL) => {
            if (!sameDestination(new URL(page.url()), expected))
              throw new Error(
                "Page reached an unexpected destination. Configure page.expectedURL for reviewed redirects or scenario.expectedURL for reviewed navigation; include its query and fragment.",
              );
          };
          const verifyAuth = async () => {
            if (!entry.auth || !config.auth) return;
            const loginPath = pageURL(
              config.auth.loginPath ?? "/login",
              config.baseURL,
            ).pathname;
            if (
              new URL(page.url()).pathname === loginPath &&
              requested.pathname !== loginPath
            )
              throw new AuthRequired(
                "Redirected to login. Refresh the test session.",
              );
            try {
              await page
                .locator(config.auth.readySelector)
                .waitFor({ state: "visible", timeout });
            } catch {
              if (scope.signal.aborted) throw scope.signal.reason;
              throw new AuthRequired(
                "The authenticated-page marker was not visible. Refresh the session or check auth.readySelector.",
              );
            }
          };
          const response = await page.goto(requested.href, {
            waitUntil: "domcontentloaded",
            timeout,
          });
          if (
            entry.auth &&
            (response?.status() === 401 || response?.status() === 403)
          )
            throw new AuthRequired(
              "Test session was rejected. Refresh it with glocon login or your auth setup command.",
            );
          if (response && !response.ok())
            throw new Error(`Page returned HTTP ${response.status()}.`);
          await verifyAuth();
          if (entry.expectedURL)
            await page.waitForURL((url) => sameDestination(url, initial), {
              waitUntil: "domcontentloaded",
              timeout,
            });
          verifyDestination(initial);
          if (scenario) await runSteps(page, scenario, result.steps!, timeout);
          if (new URL(page.url()).origin !== requested.origin)
            throw new Error("Scenario left the configured app origin.");
          const readySelector =
            scenario?.readySelector ??
            entry.readySelector ??
            config.audit?.readySelector;
          if (readySelector)
            await page
              .locator(readySelector)
              .waitFor({ state: "visible", timeout });
          if (scenario?.expectedURL)
            await page.waitForURL((url) => sameDestination(url, final), {
              waitUntil: "domcontentloaded",
              timeout,
            });
          await verifyAuth();
          verifyDestination(final);
          const report = await auditPage(page, {
            ...config.audit,
            ...(readySelector ? { readySelector } : {}),
          });
          await verifyAuth();
          verifyDestination(final);
          if (result.mocks?.some((mock) => mock.calls < mock.expectedResponses))
            throw new Error(
              "Scenario did not consume every configured mock response. Check the path, method, and steps.",
            );
          if (scenario)
            report.coverage.limitations.push(
              "Scenario coverage includes only the final state after the configured steps. Mocked API responses do not verify the backend.",
            );
          if (config.screenshots !== false && report.findings.length) {
            const filename = `screenshots/${result.id}.png`;
            try {
              await capture(
                page,
                report.findings.map((f) => f.target),
                resolve(output, filename),
              );
              result.screenshot = filename;
            } catch {
              report.coverage.limitations.push(
                "Highlighted screenshot could not be captured for this page.",
              );
            }
            report.coverage.limitations.push(
              "Screenshots show the current viewport with available light-DOM targets highlighted. Offscreen, iframe, and shadow-root targets may not be highlighted; form inputs are masked.",
            );
          }
          verifyDestination(final);
          scope.signal.throwIfAborted();
          return report;
        };
        try {
          result.report = await timed(
            check(),
            timeout * (3 + (scenario?.steps.length ?? 0)) + 10000,
            scope.signal,
            async () => {
              cancelled = true;
              await context?.close();
            },
          );
          result.status = "completed";
          delete result.message;
          if (
            result.report.coverage.complete === false &&
            !result.report.coverage.acceptedIncomplete
          ) {
            result.status = "error";
            result.message =
              "DOM collection was truncated. Increase audit.maxElements to complete this check.";
          }
        } catch (error) {
          result.status =
            error instanceof AuthRequired ? "auth-required" : "error";
          result.message = scope.signal.aborted
            ? safeError(scope.signal.reason)
            : safeError(error);
        } finally {
          await context?.close().catch(() => {});
          progress(index);
        }
      };
      let next = 0;
      // Index assignment is synchronous; only independent isolated contexts run concurrently.
      const worker = async () => {
        while (next < plans.length) await runCase(next++);
      };
      await Promise.all(
        Array.from(
          { length: Math.min(config.concurrency ?? 2, plans.length) },
          worker,
        ),
      );
    } catch (error) {
      for (const [index, result] of cases.entries()) {
        if (result.message === "Not run.")
          result.message = safeError(
            scope.signal.aborted ? scope.signal.reason : error,
          );
        progress(index);
      }
    } finally {
      scope.signal.removeEventListener("abort", closeBrowser);
      await browser?.close().catch(() => {});
      try {
        await stopServer();
      } catch (error) {
        cases[0]!.status = "error";
        cases[0]!.message = `Owned app cleanup failed: ${safeError(error)}`;
      }
    }
    const report = makeReport(config, cases, baseline);
    await writeJSON(resolve(output, "report.json"), report);
    await writeFile(resolve(output, "report.html"), renderCheckReport(report), {
      mode: 0o600,
    });
    return report;
  } finally {
    scope.dispose();
    await releaseLock();
  }
}
/** Interactive test-session capture. Existing Playwright storageState files work without this command. */
export async function login(config: CheckConfig, dir: string) {
  if (!config.auth)
    throw new Error(
      "Add auth.storageState, auth.readySelector, and auth.loginPath to glocon.check.json first.",
    );
  if (!process.stdin.isTTY)
    throw new Error(
      "glocon login needs an interactive terminal and display. In CI use auth.setupCommand or an existing test storageState.",
    );
  const scope = signalScope();
  let stopServer: () => Promise<void> = async () => {};
  let browser:
    | Awaited<ReturnType<(typeof import("playwright"))["chromium"]["launch"]>>
    | undefined;
  const close = () => {
    void browser?.close().catch(() => {});
  };
  scope.signal.addEventListener("abort", close, { once: true });
  try {
    stopServer = await ensureServer(config, dir, scope.signal);
    browser = await resolvePlaywright(dir).chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(
      pageURL(config.auth.loginPath ?? "/login", config.baseURL).href,
    );
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      await prompt.question(
        "Log in with a test account in the browser, then press Enter to save the session: ",
        { signal: scope.signal },
      );
    } finally {
      prompt.close();
    }
    if (new URL(page.url()).origin !== new URL(config.baseURL).origin)
      throw new Error(
        "Complete login and return to the configured app before saving the session.",
      );
    await page
      .locator(config.auth.readySelector)
      .waitFor({ state: "visible", timeout: 10000 });
    const file = resolve(dir, config.auth.storageState);
    await mkdir(dirname(file), { recursive: true });
    await writeJSON(file, await context.storageState());
    await chmod(file, 0o600);
    console.log(
      "Saved the test session. Run glocon check. Keep the session file out of version control.",
    );
  } finally {
    scope.signal.removeEventListener("abort", close);
    await browser?.close().catch(() => {});
    try {
      await stopServer();
    } finally {
      scope.dispose();
    }
  }
}
