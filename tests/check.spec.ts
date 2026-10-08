import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import {
  createServer as createHTTPServer,
  type RequestListener,
} from "node:http";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  symlink,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runChecks, saveBaseline, type CheckConfig } from "../src/check";
const exec = promisify(execFile);
const cli = resolve("bin/glocon.mjs");
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
  const dir = await mkdtemp(join(tmpdir(), "glocon-runner-test-"));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await writeFile(
    join(dir, "package.json"),
    '{"name":"fixture-app","type":"module"}',
  );
  await writeFile(join(dir, "server.mjs"), serverSource);
  await symlink(resolve("node_modules"), join(dir, "node_modules"), "dir");
  const config: CheckConfig = {
    version: 1,
    baseURL: `http://127.0.0.1:${port}`,
    pages: ["/", "/broken"],
    viewports: [
      { name: "phone", width: 390, height: 844 },
      { name: "desktop", width: 1280, height: 800 },
    ],
    webServer: { command: `node server.mjs ${port}`, timeout: 10000 },
    audit: { timeout: 5000 },
    screenshots: true,
  };
  return { dir, config, port };
}
async function command(dir: string, ...args: string[]) {
  try {
    return {
      ...(await exec(process.execPath, [cli, ...args], {
        cwd: dir,
        timeout: 40000,
      })),
      code: 0,
    };
  } catch (e) {
    const error = e as { stdout: string; stderr: string; code: number };
    return error;
  }
}
async function runningFixture(handle: RequestListener) {
  const dir = await mkdtemp(join(tmpdir(), "glocon-live-check-"));
  await symlink(resolve("node_modules"), join(dir, "node_modules"), "dir");
  const server = createHTTPServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const config: CheckConfig = {
    version: 1,
    baseURL: `http://127.0.0.1:${address.port}`,
    pages: ["/"],
    viewports: [{ name: "desktop", width: 1280, height: 800 }],
    audit: { accessibility: false, timeout: 5000 },
    screenshots: false,
    failOn: "none",
  };
  return {
    dir,
    config,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const readyHTML = (script = "", body = "<h1>Application</h1>") =>
  `<!doctype html><html lang="en"><head><title>Application</title><meta name="viewport" content="width=device-width"><style>body{margin:20px;font:16px system-ui;color:#111;background:#fff}</style></head><body><main>${body}</main><script>${script}</script></body></html>`;
test("installed-command flow starts/stops the app, aggregates screens, highlights findings and baselines regressions", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { dir, config } = await fixture();
  try {
    await writeFile(join(dir, "glocon.check.json"), JSON.stringify(config));
    const first = await command(dir, "check", "--json");
    expect(first.code, first.stderr).toBe(1);
    const report = JSON.parse(first.stdout);
    expect(report.summary.completed).toBe(4);
    expect(report.summary.incomplete).toBe(0);
    expect(report.summary.new).toBeGreaterThan(0);
    expect(report.summary.groups).toBeLessThan(report.summary.new);
    const screenshot = report.cases.find(
      (c: { screenshot?: string }) => c.screenshot,
    )?.screenshot;
    expect(
      (await readFile(join(dir, ".glocon", screenshot))).length,
    ).toBeGreaterThan(100);
    await page.goto(`file://${join(dir, ".glocon/report.html")}`);
    await expect(
      page.getByRole("heading", { name: "Your app, checked." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View highlighted page" }).first(),
    ).toBeVisible();
    await expect(fetch(config.baseURL)).rejects.toThrow();
    const baseline = await command(
      dir,
      "baseline",
      "--reason",
      "Reviewed fixture issue tracked in UI-1",
    );
    expect(baseline.code, baseline.stderr).toBe(0);
    const second = await command(dir, "check", "--json");
    expect(second.code, second.stderr).toBe(0);
    const repeated = JSON.parse(second.stdout);
    expect(repeated.summary.new).toBe(0);
    expect(repeated.summary.existing).toBeGreaterThan(0);
    await writeFile(
      join(dir, "server.mjs"),
      serverSource.replace(
        '<button id="unlabelled"></button>',
        '<button id="unlabelled"></button><img id="new-image" src="missing.png">',
      ),
    );
    const regression = await command(dir, "check", "--json");
    expect(regression.code).toBe(1);
    expect(JSON.parse(regression.stdout).summary.new).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("protected pages require a verified test session, and reuse an existing Playwright setup command", async () => {
  test.setTimeout(45000);
  const { dir, config, port } = await fixture();
  try {
    config.pages = ["/", { path: "/private", auth: true }];
    config.viewports = [config.viewports[0]!];
    config.auth = {
      storageState: ".glocon/auth.json",
      readySelector: "#signed-in",
      loginPath: "/login",
    };
    await mkdir(join(dir, ".glocon"));
    await writeFile(
      join(dir, ".glocon/auth.json"),
      JSON.stringify({ cookies: [], origins: [] }),
    );
    let result = await runChecks(config, { dir });
    expect(result.exitCode).toBe(2);
    expect(result.cases[0]!.status).toBe("completed");
    expect(result.cases[1]!.status).toBe("auth-required");
    await writeFile(
      join(dir, "auth-setup.mjs"),
      `import { request } from 'playwright'; const api=await request.newContext(); await api.get('http://127.0.0.1:${port}/session'); await api.storageState({path:'.glocon/auth.json'}); await api.dispose();`,
    );
    config.auth.setupCommand = "node auth-setup.mjs";
    result = await runChecks(config, { dir });
    expect(result.exitCode).toBe(0);
    expect(result.summary.completed).toBe(2);
    config.auth.setupCommand = 'node -e "process.exit(1)"';
    result = await runChecks(config, { dir });
    expect(result.exitCode).toBe(2);
    expect(result.cases[1]!.status).toBe("auth-required");
    expect(JSON.stringify(result)).not.toContain("test-session=valid");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("startup failure invalidates old results, and interrupted runs stop the owned server", async () => {
  const { dir, config } = await fixture();
  try {
    config.pages = ["/"];
    config.viewports = [config.viewports[0]!];
    config.screenshots = false;
    expect((await runChecks(config, { dir })).exitCode).toBe(0);
    config.webServer!.command = 'node -e "process.exit(1)"';
    const failed = await runChecks(config, { dir });
    expect(failed.exitCode).toBe(2);
    expect(
      JSON.parse(await readFile(join(dir, ".glocon/report.json"), "utf8"))
        .summary.incomplete,
    ).toBe(1);
    config.webServer!.command = 'node -e "setInterval(()=>{},1000)"';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    try {
      expect(
        (await runChecks(config, { dir, signal: controller.signal })).exitCode,
      ).toBe(2);
    } finally {
      clearTimeout(timer);
    }
    await expect(fetch(config.baseURL)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("reusing an existing server does not terminate it, and missing routes cannot be baselined as passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "glocon-existing-server-"));
  try {
    await symlink(resolve("node_modules"), join(dir, "node_modules"), "dir");
    const config: CheckConfig = {
      version: 1,
      baseURL: "http://127.0.0.1:4179",
      pages: ["/fixtures/healthy.html", "/missing-route"],
      viewports: [{ name: "desktop", width: 1280, height: 800 }],
      failOn: "none",
    };
    const report = await runChecks(config, { dir });
    expect(report.exitCode).toBe(2);
    expect(report.summary.completed).toBe(1);
    expect(
      (await fetch("http://127.0.0.1:4179/fixtures/healthy.html")).ok,
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("query-changing redirects are incomplete unless the initial destination is explicitly configured", async () => {
  const fixture = await runningFixture((req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    if (
      url.pathname === "/query" &&
      url.searchParams.get("state") === "expected"
    ) {
      res.writeHead(302, { location: "/query?state=wrong#destination" }).end();
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(readyHTML());
  });
  try {
    fixture.config.pages = ["/query?state=expected"];
    const unexpected = await runChecks(fixture.config, { dir: fixture.dir });
    expect(unexpected.exitCode).toBe(2);
    expect(unexpected.cases[0]!.status).toBe("error");
    expect(unexpected.cases[0]!.message).toMatch(
      /destination|redirect|expected/i,
    );
    fixture.config.pages = [
      {
        path: "/query?state=expected",
        expectedURL: `${fixture.config.baseURL}/query?state=wrong#destination`,
      },
    ];
    const reviewed = await runChecks(fixture.config, { dir: fixture.dir });
    expect(reviewed.exitCode).toBe(0);
    expect(reviewed.cases[0]!.status).toBe("completed");
    expect(reviewed.cases[0]!.report!.source).toBe(
      `${fixture.config.baseURL}/query`,
    );
    expect(reviewed.cases[0]!.id).not.toBe(unexpected.cases[0]!.id);
  } finally {
    await fixture.close();
  }
});
test("route, query, and fragment changes while waiting for readiness cannot pass as the requested page", async () => {
  const destinations: Record<string, string> = {
    "/late-route": "/login",
    "/late-query": "/late-query?state=wrong",
    "/late-fragment": "/late-fragment#wrong",
  };
  const fixture = await runningFixture((req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    const destination = destinations[url.pathname];
    res.setHeader("content-type", "text/html");
    res.end(
      readyHTML(
        destination
          ? `setTimeout(() => { history.replaceState(null, '', ${JSON.stringify(destination)}); const marker = document.createElement('p'); marker.id = 'ready'; marker.textContent = 'Ready'; document.querySelector('main').append(marker); }, 150);`
          : "",
      ),
    );
  });
  try {
    fixture.config.pages = [
      { path: "/late-route", readySelector: "#ready" },
      { path: "/late-query?state=expected", readySelector: "#ready" },
      { path: "/late-fragment", readySelector: "#ready" },
    ];
    const report = await runChecks(fixture.config, { dir: fixture.dir });
    expect(report.exitCode).toBe(2);
    expect(report.summary.incomplete).toBe(3);
    expect(report.cases.every((result) => result.status === "error")).toBe(
      true,
    );
    expect(
      report.cases.every((result) =>
        /destination|redirect|expected/i.test(result.message!),
      ),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
});
test("a destination change during font readiness is rechecked after auditing", async () => {
  const fixture = await runningFixture((req, res) => {
    if (req.url === "/slow-font.woff2") {
      setTimeout(() => res.writeHead(404).end(), 400);
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      readyHTML(
        `document.addEventListener('DOMContentLoaded', () => { const font = new FontFace('SlowFixture', 'url(/slow-font.woff2)'); document.fonts.add(font); document.body.style.fontFamily = 'SlowFixture, system-ui'; font.load().catch(() => {}); setTimeout(() => history.replaceState(null, '', '/during-audit?state=wrong#changed'), 100); });`,
        '<h1>Application</h1><p id="ready">Ready</p>',
      ),
    );
  });
  try {
    fixture.config.pages = [
      { path: "/during-audit?state=expected", readySelector: "#ready" },
    ];
    const report = await runChecks(fixture.config, { dir: fixture.dir });
    expect(report.exitCode).toBe(2);
    expect(report.cases[0]!.status).toBe("error");
    expect(report.cases[0]!.message).toMatch(/destination|redirect|expected/i);
  } finally {
    await fixture.close();
  }
});
test("axe manual contrast review keeps a previously accepted defect pending through baseline updates", async () => {
  test.setTimeout(30000);
  let gradient = false;
  const fixture = await runningFixture((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      readyHTML(
        "",
        `<h1>Application</h1><p id="contrast" style="color:#aaa;background:${gradient ? "linear-gradient(#fff,#fff)" : "#fff"}">This text still has insufficient contrast.</p>`,
      ),
    );
  });
  fixture.config.audit = { timeout: 10000 };
  try {
    const failing = await runChecks(fixture.config, { dir: fixture.dir });
    const contrast = failing.issues.find(
      (issue) =>
        issue.ruleId === "axe/color-contrast" &&
        issue.target.includes("contrast"),
    );
    expect(
      contrast,
      JSON.stringify(failing.cases.map((result) => result.message)),
    ).toBeDefined();
    await saveBaseline(
      fixture.dir,
      fixture.config,
      "Contrast repair tracked in UI-contrast",
    );
    const original = JSON.parse(
      await readFile(join(fixture.dir, "glocon.baseline.json"), "utf8"),
    );
    const accepted = original.entries.find(
      (entry: { key: string }) => entry.key === contrast!.key,
    );
    gradient = true;
    const pending = await runChecks(fixture.config, { dir: fixture.dir });
    expect(pending.summary.incomplete).toBe(0);
    expect(pending.issues.some((issue) => issue.key === contrast!.key)).toBe(
      false,
    );
    expect(pending.cases[0]!.report!.coverage.outcomes).toContainEqual({
      ruleId: "axe/color-contrast",
      target: contrast!.target,
      status: "manual-review",
    });
    expect(pending.baseline.resolved).toBe(0);
    await saveBaseline(
      fixture.dir,
      fixture.config,
      "Other findings reviewed after gradient change",
    );
    const updated = JSON.parse(
      await readFile(join(fixture.dir, "glocon.baseline.json"), "utf8"),
    );
    expect(updated.entries).toContainEqual(accepted);
    expect(
      (await runChecks(fixture.config, { dir: fixture.dir })).baseline.resolved,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});
test("the shared run deadline cancels an owned startup process before its separate startup timeout", async () => {
  test.setTimeout(15000);
  const { dir, config } = await fixture();
  config.pages = ["/"];
  config.viewports = [config.viewports[0]!];
  config.screenshots = false;
  config.runTimeout = 400;
  config.webServer!.command = 'node -e "setInterval(()=>{},1000)"';
  const started = Date.now();
  try {
    const report = await runChecks(config, { dir });
    expect(report.exitCode).toBe(2);
    expect(report.summary.incomplete).toBe(1);
    expect(report.cases[0]!.message).toMatch(/time|deadline/i);
    expect(Date.now() - started).toBeLessThan(3000);
    await expect(fetch(config.baseURL)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("startup and authentication share a deadline and cleanup prevents the setup command from completing later", async () => {
  test.setTimeout(15000);
  const { dir, config } = await fixture();
  try {
    await writeFile(
      join(dir, "server.mjs"),
      `setTimeout(async () => { await import('./server-ready.mjs'); }, 400);`,
    );
    await writeFile(join(dir, "server-ready.mjs"), serverSource);
    await mkdir(join(dir, ".glocon"));
    await writeFile(
      join(dir, ".glocon/auth.json"),
      JSON.stringify({ cookies: [], origins: [] }),
    );
    await writeFile(
      join(dir, "auth-setup.mjs"),
      `import { writeFile } from 'node:fs/promises'; await writeFile('auth-started.txt', 'started'); setTimeout(async () => { await writeFile('auth-completed.txt', 'finished'); }, 1300);`,
    );
    config.pages = [{ path: "/private", auth: true }];
    config.viewports = [config.viewports[0]!];
    config.auth = {
      storageState: ".glocon/auth.json",
      readySelector: "#signed-in",
      setupCommand: "node auth-setup.mjs",
    };
    config.runTimeout = 1500;
    config.screenshots = false;
    const started = Date.now();
    const report = await runChecks(config, { dir });
    expect(report.exitCode).toBe(2);
    expect(report.cases[0]!.message).toMatch(/time|deadline/i);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await readFile(join(dir, "auth-started.txt"), "utf8")).toBe(
      "started",
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await expect(
      readFile(join(dir, "auth-completed.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fetch(config.baseURL)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
