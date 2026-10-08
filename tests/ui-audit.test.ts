import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { auditPage } from "../src/ui/playwright";
import type { UISnapshot } from "../src/ui";

const { analyze } = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("@axe-core/playwright", () => ({
  default: class {
    withTags() {
      return this;
    }
    setLegacyMode() {
      return this;
    }
    disableRules() {
      return this;
    }
    analyze = analyze;
  },
}));
const snapshot: UISnapshot = {
  platform: "web",
  viewport: { width: 390, height: 844 },
  document: { scrollWidth: 390, clientWidth: 390 },
  elements: [],
};
const emptyResult = {
  passes: [],
  violations: [],
  incomplete: [],
  inapplicable: [],
};
function pageStub(overrides: Record<string, unknown> = {}): Page {
  let evaluations = 0;
  return {
    waitForLoadState: async () => {},
    evaluate: async () => (++evaluations === 1 ? undefined : snapshot),
    ...overrides,
  } as unknown as Page;
}

describe("page audit deadlines and measured coverage", () => {
  it("rejects an unbounded font evaluation and leaves the caller-owned page open", async () => {
    const close = vi.fn();
    const page = pageStub({ evaluate: () => new Promise(() => {}), close });
    await expect(
      auditPage(page, { timeout: 30, accessibility: false }),
    ).rejects.toThrow(/timed out.*font readiness/);
    expect(close).not.toHaveBeenCalled();
  });
  it("uses one cumulative budget across readiness phases", async () => {
    const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
    const page = pageStub({
      waitForLoadState: delay,
      locator: () => ({ waitFor: delay }),
      evaluate: delay,
    });
    await expect(
      auditPage(page, {
        timeout: 50,
        readySelector: "main",
        accessibility: false,
      }),
    ).rejects.toThrow("timed out");
  });
  it("bounds accessibility analysis even when the analyzer never settles", async () => {
    analyze.mockImplementationOnce(() => new Promise(() => {}));
    await expect(auditPage(pageStub(), { timeout: 30 })).rejects.toThrow(
      /timed out.*accessibility checks/,
    );
  });
  it("records target-level axe outcomes before findings are suppressed", async () => {
    const node = { target: ["#control"], any: [], all: [], none: [] };
    analyze.mockResolvedValueOnce({
      ...emptyResult,
      passes: [{ id: "label", nodes: [{ ...node, target: ["#named"] }] }],
      violations: [
        {
          id: "button-name",
          nodes: [node],
          impact: "critical",
          help: "Name the button",
          description: "Buttons require names",
          helpUrl: "https://example.com/button-name",
        },
      ],
      incomplete: [
        {
          id: "color-contrast",
          nodes: [node],
          helpUrl: "https://example.com/color-contrast",
        },
      ],
    });
    const report = await auditPage(pageStub(), {
      suppressions: [
        { ruleId: "axe/button-name", reason: "Reviewed exception" },
      ],
    });
    expect(report.findings).toEqual([]);
    expect(report.suppressed).toHaveLength(1);
    expect(report.coverage.outcomes).toEqual(
      expect.arrayContaining([
        { ruleId: "axe/label", target: '["#named"]', status: "passed" },
        { ruleId: "axe/button-name", target: '["#control"]', status: "failed" },
        {
          ruleId: "axe/color-contrast",
          target: '["#control"]',
          status: "manual-review",
        },
      ]),
    );
    expect(report.coverage.limitations.join(" ")).toContain(
      "Manual review required: axe/color-contrast",
    );
  });
  it("rejects invalid timeout values before touching the page", async () => {
    for (const timeout of [0, -1, NaN, Infinity, 1.5, 2147483648])
      await expect(auditPage(pageStub(), { timeout })).rejects.toThrow(
        "timeout must",
      );
  });
  it("rejects invalid rule severity before starting browser work", async () => {
    const waitForLoadState = vi.fn(() => new Promise<void>(() => {}));
    await expect(
      auditPage(pageStub({ waitForLoadState }), {
        rules: { "axe/color-contrast": "fatal" as never },
      }),
    ).rejects.toThrow("Invalid severity");
    expect(waitForLoadState).not.toHaveBeenCalled();
  });
});
