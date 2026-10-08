import { test, expect } from "@playwright/test";
import {
  mkdtemp,
  symlink,
  rm,
  readFile,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  runChecks,
  saveBaseline,
  type CheckConfig,
  type CheckScenario,
  type CheckStep,
  type RunCheckOptions,
} from "../src/check";
const enter: CheckStep[] = [
  { action: "expect", selector: "#name", value: "" },
  { action: "fill", selector: "#name", value: "private-fixture-value" },
  { action: "click", selector: "#save" },
];
const mock = (
  responses: NonNullable<CheckScenario["mocks"]>[number]["responses"],
) => [{ path: "/api/projects", method: "POST" as const, responses }];
const failure = { status: 503, json: { message: "Unavailable" } };
const success = { json: { message: "Saved" } };
async function fixture(scenarios: CheckScenario[]) {
  const dir = await mkdtemp(join(tmpdir(), "glocon-scenarios-"));
  await symlink(resolve("node_modules"), join(dir, "node_modules"), "dir");
  const config: CheckConfig = {
    version: 1,
    baseURL: "http://127.0.0.1:4179",
    pages: [{ path: "/fixtures/scenarios.html", scenarios }],
    viewports: [
      { name: "phone", width: 390, height: 844 },
      { name: "desktop", width: 1280, height: 800 },
    ],
    audit: { timeout: 1500 },
    screenshots: false,
    failOn: "none",
  };
  return { dir, config };
}
async function runningFixture(handle: RequestListener) {
  const dir = await mkdtemp(join(tmpdir(), "glocon-live-scenarios-"));
  await symlink(resolve("node_modules"), join(dir, "node_modules"), "dir");
  const server = createServer(handle);
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
const scenarioHTML = (body: string, script = "") =>
  `<!doctype html><html lang="en"><head><title>Scenario application</title><meta name="viewport" content="width=device-width"><style>body{margin:20px;font:16px system-ui;color:#111;background:#fff}button,a{display:inline-block;min-height:44px;padding:12px}</style></head><body><main>${body}</main><script>${script}</script></body></html>`;
test("loading, error, retry, and success audit isolated final states with retained input and focus", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { dir, config } = await fixture([
    {
      name: "loading",
      mocks: mock([{ pending: true }]),
      steps: [
        ...enter,
        { action: "expect", selector: "#status", text: "Saving…" },
        { action: "expect", selector: "#save", state: "disabled" },
      ],
    },
    {
      name: "error",
      mocks: mock([failure]),
      steps: [
        ...enter,
        { action: "expect", selector: "#retry", state: "focused" },
        { action: "expect", selector: "#name", value: "private-fixture-value" },
      ],
    },
    {
      name: "retry",
      mocks: mock([failure, success]),
      steps: [
        ...enter,
        { action: "expect", selector: "#retry", state: "visible" },
        { action: "click", selector: "#retry" },
        { action: "expect", selector: "#status", text: "Saved" },
        { action: "expect", selector: "#name", value: "private-fixture-value" },
        { action: "expect", selector: "#retry", state: "hidden" },
      ],
    },
    {
      name: "success",
      mocks: mock([success]),
      steps: [
        ...enter.slice(0, 2),
        { action: "press", selector: "#name", key: "Enter" },
        { action: "expect", selector: "#status", text: "Saved" },
        { action: "expect", selector: "#save", state: "enabled" },
      ],
    },
  ]);
  try {
    const report = await runChecks(config, { dir });
    expect(
      report.summary.incomplete,
      JSON.stringify(report.cases.map((c) => c.message)),
    ).toBe(0);
    expect(report.cases).toHaveLength(8);
    for (const result of report.cases) {
      expect(result.steps?.every((step) => step.status === "passed")).toBe(
        true,
      );
      expect(result.mocks?.[0]?.calls).toBe(
        result.scenario === "retry" ? 2 : 1,
      );
    }
    expect(JSON.stringify(report)).not.toContain("private-fixture-value");
    await page.goto(`file://${join(dir, ".glocon/report.html")}`);
    await page.getByText("Scenario steps", { exact: true }).first().click();
    await expect(
      page
        .getByText("POST /api/projects: 1 request(s), 1 response(s) required")
        .first(),
    ).toBeVisible();
    await expect(
      saveBaseline(dir, config, "Reviewed fixture states"),
    ).resolves.toBeGreaterThanOrEqual(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("failed expectations and unused mock responses are incomplete, cannot be baselined, and omit assertion values", async () => {
  const { dir, config } = await fixture([
    {
      name: "wrong state",
      steps: [
        { action: "expect", selector: "#name", value: "secret-expectation" },
        { action: "click", selector: "#save" },
      ],
    },
    { name: "unused mock", steps: [], mocks: mock([success]) },
    {
      name: "missing retry",
      steps: [
        ...enter,
        { action: "expect", selector: "#retry", state: "visible" },
      ],
      mocks: mock([failure, success]),
    },
  ]);
  config.viewports = [config.viewports[0]!];
  try {
    const report = await runChecks(config, { dir });
    expect(report.exitCode).toBe(2);
    expect(report.summary.incomplete).toBe(3);
    expect(report.cases[0]!.steps?.map((s) => s.status)).toEqual([
      "failed",
      "not-run",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-expectation");
    expect(report.cases[1]!.message).toContain("consume every");
    expect(report.cases[2]!.mocks?.[0]?.calls).toBe(1);
    await expect(saveBaseline(dir, config, "Cannot accept")).rejects.toThrow(
      "every configured",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a UI defect reached only after interaction fails and produces a highlighted screenshot", async () => {
  const { dir, config } = await fixture([
    {
      name: "saved result",
      mocks: mock([{ json: { message: "Saved", broken: true } }]),
      steps: [
        ...enter,
        { action: "expect", selector: "#broken-result", state: "visible" },
      ],
    },
  ]);
  config.failOn = "error";
  config.screenshots = true;
  config.viewports = [config.viewports[0]!];
  try {
    const report = await runChecks(config, { dir });
    expect(report.exitCode).toBe(1);
    expect(report.summary.completed).toBe(1);
    expect(
      report.issues.some((issue) => issue.target.includes("broken-result")),
    ).toBe(true);
    expect(
      (await readFile(join(dir, ".glocon", report.cases[0]!.screenshot!)))
        .length,
    ).toBeGreaterThan(100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("interrupting a pending request and expectation closes the context without hanging", async () => {
  test.setTimeout(15000);
  const { dir, config } = await fixture([
    {
      name: "pending",
      mocks: mock([{ pending: true }]),
      steps: [
        ...enter,
        { action: "expect", selector: "#status", text: "Will never arrive" },
      ],
    },
  ]);
  config.viewports = [config.viewports[0]!];
  config.audit = { timeout: 30000 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const report = await runChecks(config, { dir, signal: controller.signal });
    expect(report.exitCode).toBe(2);
    expect(report.summary.incomplete).toBe(1);
    expect(report.cases[0]!.message).toBe("Run interrupted.");
    expect((await fetch(config.baseURL)).ok).toBe(true);
  } finally {
    clearTimeout(timer);
    await rm(dir, { recursive: true, force: true });
  }
});
test("scenario navigation requires a reviewed final destination and rejects a lost authenticated session", async () => {
  const destination = "/dashboard?tab=saved#summary";
  const fixture = await runningFixture((req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    res.setHeader("content-type", "text/html");
    if (url.pathname === "/login") {
      res.end(scenarioHTML('<h1 id="login">Sign in again</h1>'));
      return;
    }
    if (url.pathname === "/dashboard") {
      res.end(scenarioHTML('<h1 id="signed-in">Saved dashboard</h1>'));
      return;
    }
    res.end(
      scenarioHTML(
        `<h1 id="signed-in">Account</h1><a id="open" href="${destination}">Open dashboard</a><a id="leave" href="/login?reason=expired#reauth">Expired session</a>`,
      ),
    );
  });
  try {
    await mkdir(join(fixture.dir, ".glocon"));
    await writeFile(
      join(fixture.dir, ".glocon/auth.json"),
      JSON.stringify({ cookies: [], origins: [] }),
    );
    fixture.config.auth = {
      storageState: ".glocon/auth.json",
      readySelector: "#signed-in",
      loginPath: "/login",
    };
    const navigation: CheckStep[] = [
      { action: "click", selector: "#open" },
      { action: "expect", selector: "#signed-in", text: "Saved dashboard" },
    ];
    fixture.config.pages = [
      {
        path: "/account",
        auth: true,
        scenarios: [
          { name: "unexpected navigation", steps: navigation },
          {
            name: "reviewed navigation",
            expectedURL: destination,
            steps: navigation,
          },
          {
            name: "expired session",
            expectedURL: "/login?reason=expired#reauth",
            steps: [
              { action: "click", selector: "#leave" },
              { action: "expect", selector: "#login", state: "visible" },
            ],
          },
        ],
      },
    ];
    const report = await runChecks(fixture.config, { dir: fixture.dir });
    expect(report.exitCode).toBe(2);
    expect(report.cases.map((result) => result.status)).toEqual([
      "error",
      "completed",
      "auth-required",
    ]);
    expect(report.cases[0]!.message).toMatch(/destination|redirect|expected/i);
    expect(report.cases[1]!.report!.source).toBe(
      `${fixture.config.baseURL}/dashboard`,
    );
    expect(report.cases[2]!.message).toMatch(/login|session|authenticated/i);
    expect(
      report.cases.every((result) =>
        result.steps!.every((step) => step.status === "passed"),
      ),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
});
test("bounded parallel cases isolate cookies and mocks while keeping reports in configuration order", async () => {
  test.setTimeout(20000);
  let active = 0;
  let maxActive = 0;
  let realAPIRequests = 0;
  const fixture = await runningFixture((req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    if (url.pathname === "/gate") {
      active++;
      maxActive = Math.max(maxActive, active);
      const timer = setTimeout(
        () => {
          active--;
          res.end("released");
        },
        url.searchParams.get("name") === "first" ? 800 : 40,
      );
      res.once("close", () => clearTimeout(timer));
      return;
    }
    if (url.pathname === "/api/projects") {
      realAPIRequests++;
      res.writeHead(500).end("mock was missing");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      scenarioHTML(
        '<h1>Isolated state</h1><p id="cookies"></p><button id="run">Run request</button><p id="result"></p>',
        `document.querySelector('#cookies').textContent = document.cookie || 'empty'; document.querySelector('#run').addEventListener('click', async () => { const response = await fetch('/api/projects', {method:'POST'}); const value = await response.json(); document.cookie = 'case=' + value.message + '; Path=/; SameSite=Lax'; await fetch('/gate?name=' + value.message); document.querySelector('#result').textContent = value.message + ':' + document.cookie; });`,
      ),
    );
  });
  const names = ["first", "second", "third", "fourth"];
  const progress: Array<
    Parameters<NonNullable<RunCheckOptions["onProgress"]>>[0]
  > = [];
  fixture.config.concurrency = 2;
  fixture.config.runTimeout = 10000;
  fixture.config.pages = [
    {
      path: "/parallel",
      scenarios: names.map((name) => ({
        name,
        mocks: mock([{ json: { message: name } }]),
        steps: [
          { action: "expect", selector: "#cookies", text: "empty" },
          { action: "click", selector: "#run" },
          {
            action: "expect",
            selector: "#result",
            text: `${name}:case=${name}`,
          },
        ],
      })),
    },
  ];
  try {
    const report = await runChecks(fixture.config, {
      dir: fixture.dir,
      onProgress: (event) => progress.push(event),
    });
    expect(
      report.exitCode,
      JSON.stringify(report.cases.map((result) => result.message)),
    ).toBe(0);
    expect(maxActive).toBe(2);
    expect(active).toBe(0);
    expect(realAPIRequests).toBe(0);
    expect(report.cases.map((result) => result.scenario)).toEqual(names);
    expect(report.cases.every((result) => result.mocks?.[0]?.calls === 1)).toBe(
      true,
    );
    expect(progress.map((event) => event.completed)).toEqual([1, 2, 3, 4]);
    expect(
      progress.every(
        (event) => event.total === 4 && event.status === "completed",
      ),
    ).toBe(true);
    expect(new Set(progress.map((event) => event.caseId))).toEqual(
      new Set(report.cases.map((result) => result.id)),
    );
    expect(progress[0]!.caseId).toBe(report.cases[1]!.id);
    const persisted = JSON.parse(
      await readFile(join(fixture.dir, ".glocon/report.json"), "utf8"),
    );
    expect(
      persisted.cases.map((result: { scenario: string }) => result.scenario),
    ).toEqual(names);
  } finally {
    await fixture.close();
  }
});
test("the shared run deadline cancels active browser requests, skips queued cases, and preserves a reused server", async () => {
  test.setTimeout(15000);
  let pending = 0;
  let started = 0;
  const fixture = await runningFixture((req, res) => {
    if (req.url === "/pending-request") {
      pending++;
      started++;
      res.once("close", () => pending--);
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      scenarioHTML(
        "<h1>Pending page</h1>",
        `fetch('/pending-request').catch(() => {});`,
      ),
    );
  });
  const progress: string[] = [];
  fixture.config.concurrency = 2;
  fixture.config.runTimeout = 2000;
  fixture.config.audit = { accessibility: false, timeout: 10000 };
  fixture.config.pages = ["first", "second", "third"].map((name) => ({
    path: `/pending/${name}`,
    readySelector: "#never-ready",
  }));
  try {
    const start = Date.now();
    const report = await runChecks(fixture.config, {
      dir: fixture.dir,
      onProgress: (event) => progress.push(event.caseId),
    });
    expect(report.exitCode).toBe(2);
    expect(report.summary.incomplete).toBe(3);
    expect(
      report.cases.every((result) => /time|deadline/i.test(result.message!)),
    ).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(started).toBe(2);
    await expect.poll(() => pending).toBe(0);
    expect(new Set(progress)).toEqual(
      new Set(report.cases.map((result) => result.id)),
    );
    expect((await fetch(fixture.config.baseURL)).ok).toBe(true);
  } finally {
    await fixture.close();
  }
});
