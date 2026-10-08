import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { auditPage, auditStates, assertUI } from "../src/ui/playwright";
import { collectSnapshot } from "../src/ui/browser";
import { auditSnapshot, defineContract } from "../src/ui";
const exec = promisify(execFile);
test("finds accessibility and UX defects in a real rendered page", async ({
  page,
}) => {
  await page.goto("/fixtures/broken.html");
  const report = await auditPage(page);
  const ids = report.findings.map((f) => f.ruleId);
  expect(ids).toEqual(
    expect.arrayContaining([
      "axe/button-name",
      "axe/html-has-lang",
      "layout/overflow",
      "interaction/target-size",
      "form/error-description",
      "form/placeholder-label",
      "interaction/positive-tabindex",
      "ux/busy-feedback",
    ]),
  );
  expect(report.findings.some((f) => f.target === "#hidden")).toBe(false);
  expect(() => assertUI(report)).toThrow("glocon");
});
test("healthy responsive controls pass at phone and desktop widths", async ({
  page,
}) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/fixtures/healthy.html");
    const report = await auditPage(page);
    expect(report.findings, JSON.stringify(report.findings)).toEqual([]);
  }
});
test("preserves axe and custom suppressions and disabled rules", async ({
  page,
}) => {
  await page.goto("/fixtures/broken.html");
  const report = await auditPage(page, {
    rules: { "axe/html-has-lang": "off" },
    suppressions: [
      { ruleId: "axe/button-name", reason: "Fixture exception" },
      {
        ruleId: "form/error-description",
        target: "#email",
        reason: "Fixture exception",
      },
    ],
  });
  expect(
    report.findings.some((f) =>
      [
        "axe/html-has-lang",
        "axe/button-name",
        "form/error-description",
      ].includes(f.ruleId),
    ),
  ).toBe(false);
  expect(report.suppressed.map((s) => s.finding.ruleId)).toEqual(
    expect.arrayContaining(["axe/button-name", "form/error-description"]),
  );
});
test("collects unique selectors, redacts values, and reports truncation", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html?token=private");
  await page.locator("#email").fill("private@example.com");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "email";
    button.textContent = "Duplicate ID";
    document.body.append(button);
  });
  const snapshot = await page.evaluate(collectSnapshot, {});
  expect(new Set(snapshot.elements.map((e) => e.target)).size).toBe(
    snapshot.elements.length,
  );
  expect(JSON.stringify(snapshot)).not.toContain("private@example.com");
  expect(snapshot.url).not.toContain("token=");
  const limited = await page.evaluate(collectSnapshot, { maxElements: 5 });
  expect(limited.limitations?.join(" ")).toContain("truncated");
});
test("state contracts verify visible requirements and mark missing scenarios", async ({
  page,
}) => {
  await page.goto("/react");
  await expect(
    page.getByRole("heading", { name: "No orders yet" }),
  ).toBeVisible();
  const contract = defineContract({
    name: "orders",
    states: {
      empty: {
        required: [
          {
            selector: '[data-glocon-state="empty"] h2',
            description: "empty explanation",
          },
        ],
      },
      loading: {
        required: [
          {
            selector: '[data-glocon-state="loading"] [role="status"]',
            description: "loading feedback",
          },
        ],
      },
      error: {
        required: [{ selector: "#retry", description: "retry button" }],
      },
      success: {
        required: [
          {
            selector: '[data-glocon-state="success"] li',
            description: "order rows",
          },
        ],
      },
    },
  });
  const report = await auditStates(page, contract, {
    empty: async () => {},
    loading: async (p) => {
      await p.getByRole("button", { name: "Load orders" }).click();
      await expect(p.getByText("Loading orders…")).toBeVisible();
    },
    error: async (p) => {
      await p.getByRole("button", { name: "Simulate failure" }).click();
      await expect(p.locator("#retry")).toBeVisible();
    },
  });
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0]).toMatchObject({
    ruleId: "contract/untested-state",
    target: "orders/success",
  });
});
test("React controls keep focus, prevent repeat actions, and preserve form input", async ({
  page,
}) => {
  await page.goto("/react");
  const field = page.getByRole("textbox", { name: "Email address" });
  await field.fill("developer@example.com");
  await page.locator("#save").click();
  await expect(
    page.getByRole("status").filter({ hasText: "Actions: 1" }),
  ).toBeVisible();
  await expect(page.locator("#save")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("status").filter({ hasText: "Actions: 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show field error" }).click();
  await expect(field).toHaveValue("developer@example.com");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(
    "Use your work email address. Enter a valid work email address.",
  );
  expect((await auditPage(page)).findings).toEqual([]);
});
test("React controls pass in dark mode and narrow layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/react");
  await expect(page.locator("#save")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.gloconTheme = "dark";
    document.body.style.background = "#18181b";
    document.body.style.color = "#fafafa";
  });
  expect((await auditPage(page)).findings).toEqual([]);
});
test("published CLI produces JSON and meaningful exit codes", async () => {
  const ok = await exec(process.execPath, [
    "bin/glocon.mjs",
    "audit",
    "http://127.0.0.1:4179/fixtures/healthy.html",
    "--json",
  ]);
  expect(JSON.parse(ok.stdout).findings).toEqual([]);
  try {
    await exec(process.execPath, [
      "bin/glocon.mjs",
      "audit",
      "http://127.0.0.1:4179/fixtures/broken.html",
      "--json",
    ]);
    throw new Error("Expected CLI failure");
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string };
    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout).summary.error).toBeGreaterThan(0);
  }
  await expect(
    exec(process.execPath, [
      "bin/glocon.mjs",
      "audit",
      "file:///tmp/example.html",
    ]),
  ).rejects.toMatchObject({ code: 2 });
});

test("financial calculation, invoice and partial credit core runs in the browser", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/finance");
  await expect(page.locator("#result")).toHaveText(
    JSON.stringify({ gross: "2200", credit: "1100" }),
  );
  expect(errors).toEqual([]);
});

test("CLI waits for delayed styles before measuring controls", async () => {
  const result = await exec(process.execPath, [
    "bin/glocon.mjs",
    "audit",
    "http://127.0.0.1:4179/delayed-styles",
    "--json",
  ]);
  expect(JSON.parse(result.stdout).findings).toEqual([]);
});

test("CLI refuses an unexpected redirect and accepts an explicitly selected destination", async () => {
  const url = "http://127.0.0.1:4179/protected?private=secret";
  await expect(
    exec(process.execPath, ["bin/glocon.mjs", "audit", url, "--json"]),
  ).rejects.toMatchObject({ code: 2 });
  const accepted = await exec(process.execPath, [
    "bin/glocon.mjs",
    "audit",
    url,
    "--expected-url",
    "http://127.0.0.1:4179/fixtures/healthy.html",
    "--json",
  ]);
  expect(JSON.parse(accepted.stdout).coverage.complete).toBe(true);
  expect(accepted.stdout).not.toContain("secret");
});
test("CLI identifies incomplete collection even when findings are disabled", async () => {
  const args = [
    "bin/glocon.mjs",
    "audit",
    "http://127.0.0.1:4179/fixtures/broken.html",
    "--json",
    "--no-a11y",
    "--max-elements",
    "1",
    "--fail-on",
    "none",
  ];
  await expect(exec(process.execPath, args)).rejects.toMatchObject({ code: 2 });
  const partial = await exec(process.execPath, [...args, "--allow-truncated"]);
  expect(JSON.parse(partial.stdout).coverage).toMatchObject({
    complete: false,
    acceptedIncomplete: true,
    collection: { inspected: 1, truncated: true },
  });
});

test("metered invoice and exact fractional credits run in the browser", async ({
  page,
}) => {
  await page.goto("/finance");
  await expect(page.locator("#metered-result")).toHaveText(
    JSON.stringify({
      engine: "glocon-order-3",
      gross: "17",
      credits: ["5", "6", "6"],
    }),
  );
});

test("collector respects visible descendants and CSS overrides of hidden", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html");
  await page.setContent(`<!doctype html><html lang="en"><body><main>
    <div style="visibility:hidden"><button id="visible-child" style="visibility:visible;width:12px;height:12px;padding:0;border:0">Save</button></div>
    <div style="opacity:0"><button id="transparent-child">Hidden</button></div>
    <div style="display:none"><button id="hidden-child">Hidden</button></div>
    <button id="hidden-override" hidden style="display:block;width:44px;height:44px">Visible</button>
  </main></body></html>`);
  const snapshot = await page.evaluate(collectSnapshot, {});
  expect(
    snapshot.elements.find((element) => element.target === "#visible-child")
      ?.visible,
  ).toBe(true);
  expect(
    snapshot.elements.find((element) => element.target === "#hidden-override")
      ?.visible,
  ).toBe(true);
  expect(
    snapshot.elements.find((element) => element.target === "#transparent-child")
      ?.visible,
  ).toBe(false);
  expect(
    snapshot.elements.find((element) => element.target === "#hidden-child")
      ?.visible,
  ).toBe(false);
  expect(auditSnapshot(snapshot).findings).toEqual([
    expect.objectContaining({
      ruleId: "interaction/target-size",
      target: "#visible-child",
    }),
  ]);
});

test("collector detects rendered label text without requiring a label box", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html");
  await page.setContent(`<!doctype html><html lang="en"><body><main>
    <label id="contents-label" style="display:contents">Email<input id="contents-input" placeholder="Work email" style="height:44px"></label>
    <label for="hidden-label-input"><span style="visibility:hidden">Hidden label</span></label>
    <input id="hidden-label-input" placeholder="Work email" style="height:44px">
  </main></body></html>`);
  const snapshot = await page.evaluate(collectSnapshot, {});
  expect(
    snapshot.elements.find((element) => element.target === "#contents-label")
      ?.visible,
  ).toBe(true);
  expect(
    snapshot.elements.find((element) => element.target === "#contents-input")
      ?.attributes["data-glocon-visible-label"],
  ).toBe("true");
  expect(auditSnapshot(snapshot).findings).toEqual([
    expect.objectContaining({
      ruleId: "form/placeholder-label",
      target: "#hidden-label-input",
    }),
  ]);
});

test("display contents controls use their rendered content hit area", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html");
  await page.setContent(`<!doctype html><html lang="en"><body><main>
    <a id="contents-link" href="#destination" style="display:contents"><span style="display:block;width:100px;height:100px">Open destination</span></a>
  </main></body></html>`);
  const snapshot = await page.evaluate(collectSnapshot, {});
  const link = snapshot.elements.find(
    (element) => element.target === "#contents-link",
  );
  expect(link?.visible).toBe(true);
  expect(link?.rect).toMatchObject({ width: 100, height: 100 });
  expect(auditSnapshot(snapshot).findings).toEqual([]);
});

test("deep display contents trees are inspected without recursive call stack growth", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html");
  for (const depth of [30, 4500]) {
    await page.evaluate((depth) => {
      document.body.innerHTML = "<main></main>";
      let parent = document.querySelector("main")!;
      for (let index = 0; index < depth; index++) {
        const child = document.createElement("div");
        child.id = `deep-${index}`;
        child.style.display = "contents";
        parent.append(child);
        parent = child;
      }
      const button = document.createElement("button");
      button.id = "deep-button";
      button.textContent = "Save";
      button.style.cssText = "width:44px;height:44px";
      parent.append(button);
    }, depth);
    const results = await page.evaluate(
      ({ collector }) => {
        const snapshot = (0, eval)(`(${collector})`)({});
        const rect = document
          .querySelector("#deep-button")!
          .getBoundingClientRect();
        return {
          inspected: snapshot.collection.inspected,
          truncated: snapshot.collection.truncated,
          rendered: rect.width > 0 && rect.height > 0,
          outerVisible: snapshot.elements.find(
            (element: { target: string }) => element.target === "#deep-0",
          ).visible,
          buttonVisible: snapshot.elements.find(
            (element: { target: string }) => element.target === "#deep-button",
          ).visible,
        };
      },
      { collector: collectSnapshot.toString() },
    );
    if (depth === 30) expect(results.rendered).toBe(true);
    // Extreme DOM depth may exceed a browser's rendering limit. Collection still
    // completes and its visibility must reflect the browser's measured geometry.
    expect(results).toMatchObject({
      truncated: false,
      outerVisible: results.rendered,
      buttonVisible: results.rendered,
    });
    expect(results.inspected).toBeGreaterThan(depth);
  }
});

test("nested inline suppressions inherit every applicable ancestor declaration", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html");
  await page.setContent(`<!doctype html><html lang="en"><body><main>
    <section id="outer-ignore" data-glocon-ignore="interaction/target-size">
      <div id="inner-ignore" data-glocon-ignore="interaction/positive-tabindex">
        <span data-glocon-ignore=""><button id="nested-ignore" tabindex="3" style="width:12px;height:12px;padding:0;border:0">Save</button></span>
      </div>
    </section>
  </main></body></html>`);
  const snapshot = await page.evaluate(collectSnapshot, {});
  expect(
    snapshot.elements.find((element) => element.target === "#nested-ignore")
      ?.ignore,
  ).toEqual(["interaction/target-size", "interaction/positive-tabindex"]);
  const report = auditSnapshot(snapshot);
  expect(report.findings).toEqual([]);
  expect(
    report.coverage.limitations.filter((limitation) =>
      limitation.startsWith("Inline suppression"),
    ),
  ).toEqual([
    "Inline suppression at #outer-ignore: interaction/target-size (custom rules only).",
    "Inline suppression at #inner-ignore: interaction/positive-tabindex (custom rules only).",
  ]);
});

test("wide sibling lists do not repeatedly scan their complete parent collection", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html");
  const result = await page.evaluate(
    ({ collector, count }) => {
      document.body.innerHTML = `<main>${Array.from({ length: count }, () => '<button style="width:44px;height:44px">Save</button>').join("")}</main>`;
      const descriptor = Object.getOwnPropertyDescriptor(
        Element.prototype,
        "children",
      )!;
      let siblingsRead = 0;
      Object.defineProperty(Element.prototype, "children", {
        ...descriptor,
        get() {
          const children = descriptor.get!.call(this) as HTMLCollection;
          siblingsRead += children.length;
          return children;
        },
      });
      try {
        const snapshot = (0, eval)(`(${collector})`)({});
        return {
          siblingsRead,
          targets: new Set(
            snapshot.elements.map(
              (element: { target: string }) => element.target,
            ),
          ).size,
          elements: snapshot.elements.length,
          lastTargetMatches:
            document.querySelector(snapshot.elements.at(-1).target) ===
            document.querySelector("main")!.lastElementChild,
        };
      } finally {
        Object.defineProperty(Element.prototype, "children", descriptor);
      }
    },
    { collector: collectSnapshot.toString(), count: 2048 },
  );
  expect(result.siblingsRead).toBeLessThan(2048 * 6);
  expect(result.targets).toBe(result.elements);
  expect(result.lastTargetMatches).toBe(true);
});

test("auditPage bounds stalled dynamic font readiness", async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/stalled-audit-font.woff", async (route) => {
    await blocked;
    await route.abort().catch(() => {});
  });
  await page.goto("/fixtures/healthy.html");
  await page.evaluate(() => {
    const font = new FontFace(
      "AuditStalledFont",
      'url("/stalled-audit-font.woff")',
    );
    document.fonts.add(font);
    void font.load().catch(() => {});
  });
  try {
    await expect(
      auditPage(page, { timeout: 200, accessibility: false }),
    ).rejects.toThrow(/timed out.*font readiness/);
  } finally {
    release();
  }
});

test("CLI exits and cleans up when dynamic font readiness exceeds its total budget", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/stalled-font.woff") return;
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html lang="en"><head><title>Font timeout</title></head><body><main><h1>Font timeout</h1></main>
      <script>addEventListener("load", () => {
        const font = new FontFace("StalledFont", "url(/stalled-font.woff)");
        document.fonts.add(font);
        font.load().catch(() => {});
      });</script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    await expect(
      exec(
        process.execPath,
        [
          "bin/glocon.mjs",
          "audit",
          `http://127.0.0.1:${address.port}/`,
          "--timeout",
          "1500",
          "--no-a11y",
          "--json",
        ],
        { timeout: 10000 },
      ),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringMatching(/timed out/i),
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("CLI waits for a reviewed SPA destination before checking its settled content", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html lang="en"><head><title>Reviewed SPA destination</title></head><body><main><h1>Loading</h1></main>
      <script>setTimeout(() => {
        history.replaceState({}, "", "/settled");
        document.querySelector("main").innerHTML = '<h1 id="ready">Reviewed destination</h1>';
      }, 100);</script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    const origin = `http://127.0.0.1:${address.port}`;
    const result = await exec(
      process.execPath,
      [
        "bin/glocon.mjs",
        "audit",
        `${origin}/initial`,
        "--expected-url",
        `${origin}/settled`,
        "--ready",
        "#ready",
        "--no-a11y",
        "--json",
      ],
      { timeout: 10000 },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      source: `${origin}/settled`,
      findings: [],
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("explicit same-origin accessibility mode reports its frame limit and still finds defects", async ({
  page,
}) => {
  await page.goto("/fixtures/healthy.html");
  const healthy = await auditPage(page, { accessibilityMode: "same-origin" });
  expect(healthy.findings).toEqual([]);
  expect(healthy.coverage.limitations.join(" ")).toContain(
    "does not test cross-origin frames",
  );
  await page.evaluate(() => {
    const button = document.createElement("button");
    document.querySelector("main")!.append(button);
  });
  expect(
    (await auditPage(page, { accessibilityMode: "same-origin" })).findings.some(
      (finding) => finding.ruleId === "axe/button-name",
    ),
  ).toBe(true);
  await expect(
    auditPage(page, { accessibilityMode: "invalid" as "standard" }),
  ).rejects.toThrow("Unknown accessibilityMode");
});
