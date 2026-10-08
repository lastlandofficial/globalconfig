import { describe, expect, it } from "vitest";
import {
  auditSnapshot,
  checkContract,
  createReport,
  defineContract,
  fingerprint,
  shouldFail,
  type ElementSnapshot,
  type Rule,
  type UISnapshot,
} from "../src/ui";
import { auditNative } from "../src/ui/native";
const element = (
  overrides: Partial<ElementSnapshot> = {},
): ElementSnapshot => ({
  target: "#save",
  tag: "button",
  role: "button",
  name: "Save",
  visible: true,
  disabled: false,
  interactive: true,
  rect: { x: 0, y: 0, width: 44, height: 44 },
  attributes: {},
  styles: { display: "inline-block" },
  ignore: [],
  ...overrides,
});
const snapshot = (
  elements: ElementSnapshot[] = [],
  overrides: Partial<UISnapshot> = {},
): UISnapshot => ({
  platform: "web",
  viewport: { width: 390, height: 844 },
  document: { clientWidth: 390, scrollWidth: 390 },
  elements,
  ...overrides,
});
const ids = (report: ReturnType<typeof auditSnapshot>) =>
  report.findings.map((f) => f.ruleId);

describe("evidence-based rules", () => {
  it("does not penalize an empty snapshot with imaginary missing UI", () => {
    expect(auditSnapshot(snapshot()).findings).toEqual([]);
  });
  it("reports measured overflow, allowing subpixel rounding", () => {
    expect(
      ids(
        auditSnapshot(
          snapshot([], { document: { clientWidth: 390, scrollWidth: 850 } }),
        ),
      ),
    ).toContain("layout/overflow");
    expect(
      ids(
        auditSnapshot(
          snapshot([], { document: { clientWidth: 390, scrollWidth: 391 } }),
        ),
      ),
    ).not.toContain("layout/overflow");
  });
  it("treats target size as a heuristic and excludes hidden, disabled, and inline controls", () => {
    const small = { rect: { x: 0, y: 0, width: 12, height: 12 } };
    const report = auditSnapshot(
      snapshot([
        element(small),
        element({ ...small, target: "#hidden", visible: false }),
        element({ ...small, target: "#disabled", disabled: true }),
        element({ ...small, target: "#inline", styles: { display: "inline" } }),
      ]),
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: "interaction/target-size",
      confidence: "medium",
      severity: "warning",
      evidence: { width: 12 },
    });
    expect(shouldFail(report)).toBe(false);
    expect(shouldFail(report, "warning")).toBe(true);
  });
  it("requires an explicit scale and tolerates fractional rounding and negative margins", () => {
    const page = snapshot([
      element({
        styles: {
          paddingTop: "13px",
          marginTop: "-8px",
          marginRight: "8.25px",
        },
      }),
    ]);
    expect(ids(auditSnapshot(page))).not.toContain("consistency/spacing");
    const report = auditSnapshot(page, { spacingScale: [0, 4, 8, 12, 16] });
    expect(report.findings[0]?.evidence.properties).toEqual([
      "paddingTop: 13px",
    ]);
  });
  it("compares declared peers only, requires a majority, and separates state and variant", () => {
    const peer = (
      target: string,
      padding: string,
      extra: Partial<ElementSnapshot> = {},
    ) =>
      element({
        target,
        component: "Button",
        styles: { paddingTop: padding },
        ...extra,
      });
    expect(
      ids(
        auditSnapshot(
          snapshot([peer("#a", "8px"), peer("#b", "8px"), peer("#c", "9px")]),
        ),
      ),
    ).toContain("consistency/component-drift");
    expect(
      ids(auditSnapshot(snapshot([peer("#a", "8px"), peer("#b", "9px")]))),
    ).not.toContain("consistency/component-drift");
    expect(
      ids(
        auditSnapshot(
          snapshot([
            peer("#a", "8px"),
            peer("#b", "8px"),
            peer("#c", "9px", { variant: "large" }),
          ]),
        ),
      ),
    ).not.toContain("consistency/component-drift");
    expect(
      ids(
        auditSnapshot(
          snapshot([
            peer("#a", "8px"),
            peer("#b", "8px"),
            peer("#c", "9px", { disabled: true }),
          ]),
        ),
      ),
    ).not.toContain("consistency/component-drift");
  });
  it("invalid fields need a linked description and placeholders need a visible label", () => {
    const bad = element({
      tag: "input",
      attributes: { "aria-invalid": "true", placeholder: "present" },
    });
    expect(ids(auditSnapshot(snapshot([bad])))).toEqual(
      expect.arrayContaining([
        "form/error-description",
        "form/placeholder-label",
      ]),
    );
    const fixed = {
      ...bad,
      attributes: {
        ...bad.attributes,
        "data-glocon-error-text": "true",
        "data-glocon-visible-label": "true",
      },
    };
    expect(auditSnapshot(snapshot([fixed])).findings).toEqual([]);
  });
});
describe("report controls and custom rules", () => {
  const page = snapshot([element({ attributes: { tabindex: "3" } })]);
  it("preserves reasons for suppressed findings", () => {
    const report = auditSnapshot(page, {
      suppressions: [
        {
          ruleId: "interaction/positive-tabindex",
          target: "#save",
          reason: "Legacy widget migration tracked separately",
        },
      ],
    });
    expect(report.findings).toHaveLength(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.summary.total).toBe(0);
  });
  it("supports rule severity overrides and deterministic IDs", () => {
    const first = auditSnapshot(page, {
      rules: { "interaction/positive-tabindex": "error" },
    });
    expect(shouldFail(first)).toBe(true);
    expect(first.findings[0]?.fingerprint).toBe(
      auditSnapshot(page).findings[0]?.fingerprint,
    );
    expect(fingerprint("a", "bc")).not.toBe(fingerprint("ab", "c"));
    expect(shouldFail(first, "none")).toBe(false);
  });
  it("preserves ASCII fingerprints and distinguishes supplementary Unicode targets", () => {
    expect(fingerprint("contract/missing-ui", "x/loaded #save")).toBe(
      "glocon-f45e8163",
    );
    const native = auditNative(
      ["😀", "😁"].map((testID) => ({
        testID,
        accessibilityRole: "button",
        frame: { x: 0, y: 0, width: 48, height: 48 },
      })),
      { width: 390, height: 844 },
    );
    expect(native.findings).toHaveLength(2);
    expect(
      new Set(native.findings.map((finding) => finding.fingerprint)).size,
    ).toBe(2);
  });
  it("rejects invalid severities at every public audit entry point", () => {
    const options = { rules: { "contract/missing-ui": "fatal" } } as never;
    const contract = defineContract({
      name: "save",
      states: {
        loaded: {
          required: [{ selector: "#save", description: "save button" }],
        },
      },
    });
    expect(() => auditSnapshot(page, options)).toThrow("Invalid severity");
    expect(() =>
      checkContract(
        contract,
        { loaded: { visibleCounts: { "#save": 0 } } },
        options,
      ),
    ).toThrow("Invalid severity");
    expect(() =>
      createReport(
        "test",
        [],
        { rules: [], elements: 0, limitations: [] },
        options,
      ),
    ).toThrow("Invalid severity");
    const report = auditSnapshot(page);
    expect(() =>
      createReport(
        report.source,
        [{ ...report.findings[0]!, severity: "fatal" } as never],
        report.coverage,
      ),
    ).toThrow("Invalid finding severity");
    expect(() => shouldFail(report, "fatal" as never)).toThrow("threshold");
  });
  it("rejects config typos, invalid thresholds, and unreasoned suppressions", () => {
    expect(() => auditSnapshot(page, { rules: { typo: "off" } })).toThrow(
      "Unknown rule",
    );
    expect(() => auditSnapshot(page, { targetSize: -1 })).toThrow("targetSize");
    expect(() => auditSnapshot(page, { spacingScale: [Number.NaN] })).toThrow(
      "spacingScale",
    );
    expect(() =>
      auditSnapshot(page, {
        suppressions: [{ ruleId: "anything", reason: "" }],
      }),
    ).toThrow("reason");
  });
  it("runs custom rules and rejects conflicting IDs", () => {
    const rule: Rule = {
      meta: {
        id: "project/test",
        title: "Required feature",
        rationale: "Project policy",
        category: "ux",
        severity: "error",
        confidence: "high",
      },
      check: () => [
        {
          target: "app",
          message: "Missing feature",
          evidence: {},
          suggestion: "Add feature",
        },
      ],
    };
    expect(ids(auditSnapshot(page, {}, [rule]))).toContain("project/test");
    expect(() => auditSnapshot(page, {}, [rule, rule])).toThrow("unique");
    expect(() =>
      auditSnapshot(page, {}, [
        { ...rule, meta: { ...rule.meta, severity: "fatal" } } as never,
      ]),
    ).toThrow("Invalid rule severity");
    expect(() =>
      auditSnapshot(page, {}, [
        { ...rule, meta: { ...rule.meta, confidence: "certain" } } as never,
      ]),
    ).toThrow("Invalid rule confidence");
    expect(() =>
      auditSnapshot(page, {}, [
        { ...rule, meta: { ...rule.meta, category: "security" } } as never,
      ]),
    ).toThrow("Invalid rule category");
    expect(() =>
      auditSnapshot(page, {}, [{ ...rule, meta: { ...rule.meta, id: " " } }]),
    ).toThrow("non-empty id");
  });
  it("records actual rule outcomes before suppressions and skips disabled rules", () => {
    const ruleId = "interaction/positive-tabindex";
    const suppressed = auditSnapshot(page, {
      suppressions: [{ ruleId, reason: "Tracked migration" }],
    });
    expect(suppressed.findings).toEqual([]);
    expect(suppressed.coverage.outcomes).toContainEqual({
      ruleId,
      target: "#save",
      status: "failed",
    });
    expect(suppressed.coverage.outcomes).toContainEqual({
      ruleId: "layout/overflow",
      status: "passed",
    });
    const inlineIgnored = auditSnapshot(
      snapshot([element({ attributes: { tabindex: "3" }, ignore: [ruleId] })]),
    );
    expect(inlineIgnored.findings).toEqual([]);
    expect(inlineIgnored.coverage.outcomes).toContainEqual({
      ruleId,
      target: "#save",
      status: "failed",
    });
    const disabled = auditSnapshot(page, { rules: { [ruleId]: "off" } });
    expect(
      disabled.coverage.outcomes?.some((outcome) => outcome.ruleId === ruleId),
    ).toBe(false);
    const reprocessed = createReport(
      suppressed.source,
      suppressed.findings,
      suppressed.coverage,
    );
    expect(reprocessed.coverage.outcomes).toEqual(suppressed.coverage.outcomes);
  });
  it("keeps element target lookups linear when a page has thousands of findings", () => {
    const count = 2048;
    let targetReads = 0;
    const elements = Array.from({ length: count }, (_, index) => {
      const control = element({ rect: { x: 0, y: 0, width: 12, height: 12 } });
      Object.defineProperty(control, "target", {
        get: () => {
          targetReads++;
          return `#control-${index}`;
        },
      });
      return control;
    });
    const report = auditSnapshot(snapshot(elements));
    expect(report.findings).toHaveLength(count);
    expect(targetReads).toBeLessThan(count * 10);
  });
  it("does not invent element passes for custom rules with unknown applicability", () => {
    const custom: Rule = {
      meta: {
        id: "project/external-state",
        title: "External state requirement",
        rationale: "The project defines the applicable targets.",
        category: "ux",
        severity: "error",
        confidence: "high",
      },
      check: () => [],
    };
    const passed = auditSnapshot(snapshot([element()]), {}, [custom]);
    expect(passed.coverage.targets).toEqual(["#save", "html"]);
    expect(passed.coverage.targets).not.toContain("external-state");
    expect(
      passed.coverage.outcomes?.filter(
        (outcome) => outcome.ruleId === custom.meta.id,
      ),
    ).toEqual([{ ruleId: custom.meta.id, status: "passed" }]);
    const failed = auditSnapshot(snapshot([element()]), {}, [
      {
        ...custom,
        check: () => [
          {
            target: "external-state",
            message: "The external state is missing.",
            evidence: {},
            suggestion: "Enter the required state.",
          },
        ],
      },
    ]);
    expect(
      failed.coverage.outcomes?.filter(
        (outcome) => outcome.ruleId === custom.meta.id,
      ),
    ).toEqual([
      { ruleId: custom.meta.id, target: "external-state", status: "failed" },
    ]);
  });
  it("records observed targets once and explicitly passes the checked web document", () => {
    const clean = auditSnapshot(snapshot([element({ target: "#app" })]));
    expect(clean.coverage.targets).toEqual(["#app", "html"]);
    expect(clean.coverage.outcomes).toContainEqual({
      ruleId: "layout/overflow",
      target: "html",
      status: "passed",
    });
    const removed = auditSnapshot(snapshot([]));
    expect(removed.coverage.targets).toEqual(["html"]);
    expect(removed.coverage.targets).not.toContain("#app");
    const native = auditNative([], { width: 390, height: 844 });
    expect(native.coverage.targets).toEqual([]);
    const overflowing = auditSnapshot(
      snapshot([], { document: { clientWidth: 390, scrollWidth: 500 } }),
    );
    expect(overflowing.coverage.targets).toEqual(["html"]);
    expect(overflowing.coverage.outcomes).toContainEqual({
      ruleId: "layout/overflow",
      target: "html",
      status: "failed",
    });
    expect(overflowing.coverage.outcomes).not.toContainEqual({
      ruleId: "layout/overflow",
      target: "html",
      status: "passed",
    });
  });
});
describe("state contracts", () => {
  const contract = defineContract({
    name: "orders",
    states: {
      loading: {
        required: [
          { selector: '[role="status"]', description: "loading feedback" },
        ],
      },
      error: {
        required: [{ selector: "#retry", description: "a retry action" }],
      },
    },
  });
  it("separates an unobserved scenario from observed missing UI", () => {
    const report = checkContract(contract, {
      error: { visibleCounts: { "#retry": 0 } },
    });
    expect(report.summary).toEqual({ error: 1, warning: 1, info: 0, total: 2 });
    expect(report.findings[0]).toMatchObject({
      ruleId: "contract/missing-ui",
      evidence: { observed: 0 },
    });
    expect(report.findings[1]?.ruleId).toBe("contract/untested-state");
  });
  it("passes only when all declared requirements are observed", () => {
    const report = checkContract(contract, {
      loading: { visibleCounts: { '[role="status"]': 1 } },
      error: { visibleCounts: { "#retry": 1 } },
    });
    expect(report.findings).toHaveLength(0);
  });
  it("rejects incomplete observations instead of reporting absence as fact", () => {
    expect(() =>
      checkContract(contract, { error: { visibleCounts: {} } }),
    ).toThrow("Missing or invalid observation");
    expect(() =>
      checkContract(contract, { erorr: { visibleCounts: {} } }),
    ).toThrow("Unknown observed state");
    expect(() => defineContract({ name: "blank", states: {} })).toThrow(
      "at least one state",
    );
  });
});
describe("native adapter", () => {
  it("checks native names and native-sized targets without claiming device coverage", () => {
    const report = auditNative(
      [
        {
          testID: "save",
          accessibilityRole: "button",
          frame: { x: 0, y: 0, width: 30, height: 30 },
        },
      ],
      { width: 390, height: 844 },
    );
    expect(ids(report)).toEqual(
      expect.arrayContaining([
        "native/control-name",
        "interaction/target-size",
      ]),
    );
    expect(report.coverage.limitations.join(" ")).toContain(
      "not device automation",
    );
  });
  it("accepts computed accessible names and rejects duplicate native IDs", () => {
    const node = {
      testID: "save",
      accessibilityRole: "button",
      accessibleName: "Save",
      frame: { x: 0, y: 0, width: 48, height: 48 },
    };
    expect(
      auditNative([node], { width: 390, height: 844 }).findings,
    ).toHaveLength(0);
    expect(() =>
      auditNative([node, node], { width: 390, height: 844 }),
    ).toThrow("unique");
  });
});

describe("collection completeness", () => {
  it("cannot pass a truncated measurement at any finding threshold", () => {
    const partial = snapshot([], {
      collection: { total: 100, inspected: 1, truncated: true },
    });
    const report = auditSnapshot(partial);
    expect(report.coverage.complete).toBe(false);
    expect(shouldFail(report, "none")).toBe(true);
    const accepted = auditSnapshot(partial, {
      coveragePolicy: "allow-truncated",
    });
    expect(accepted.coverage.complete).toBe(false);
    expect(accepted.coverage.acceptedIncomplete).toBe(true);
    expect(shouldFail(accepted)).toBe(false);
  });
  it("rejects incomplete native rectangles and malformed viewports", () => {
    const valid = {
      testID: "save",
      accessibleName: "Save",
      accessibilityRole: "button",
      frame: { x: 0, y: 0, width: 48, height: 48 },
    };
    for (const frame of [
      {},
      { width: 48, height: 48 },
      { ...valid.frame, x: NaN },
      { ...valid.frame, height: -1 },
      { ...valid.frame, width: "48" },
    ]) {
      expect(() =>
        auditNative([{ ...valid, frame } as never], {
          width: 390,
          height: 844,
        }),
      ).toThrow();
    }
    for (const viewport of [
      null,
      {},
      { width: 0, height: 844 },
      { width: Infinity, height: 844 },
      { width: "390", height: 844 },
    ]) {
      expect(() => auditNative([valid], viewport as never)).toThrow();
    }
    expect(() =>
      auditNative([{ ...valid, disabled: "false" } as never], {
        width: 390,
        height: 844,
      }),
    ).toThrow();
  });
});
