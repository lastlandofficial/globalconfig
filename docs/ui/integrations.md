# Integration guide

## Package entry points

| Import | Exports / purpose | Runtime requirement |
| --- | --- | --- |
| `glocon` | `auditSnapshot`, `rules`, `defineContract`, `checkContract`, `createReport`, `formatReport`, `fingerprint`, `shouldFail`, types | JS runtime |
| `glocon/browser` | `collectSnapshot`, `auditDocument` | Browser DOM and layout |
| `glocon/playwright` | `auditPage`, `auditStates`, `assertUI`, `matchers` | Node.js, Playwright Page, installed browser; optional `@axe-core/playwright` for accessibility |
| `glocon/react` | `Button`, `Field`, `Status`, `EmptyState`, `AsyncState`, `Stack` and props | React 18/19 |
| `glocon/native` | `fromNativeNodes`, `auditNative`, types | Supplied measured native nodes |
| `glocon/styles.css` | Component styles and tokens | CSS pipeline or browser |
| `glocon/tokens.css` | Tokens only | CSS pipeline or browser |

## Next.js / TanStack Start

Audit the running application URL or use a Playwright test with your existing authenticated context. Wait for the actual application state before scanning. Add React primitives inside client components where interactive handlers or client state are needed. The `glocon/react` bundle preserves its `use client` directive; the root audit engine imports neither React nor browser globals. Import CSS in the location supported by your framework, such as an application root layout.

No Next.js or TanStack plugin is necessary for runtime auditing. Source-code analysis is not included. `glocon init --ui` discovers static Next.js App Router and Pages Router routes; dynamic parameters, route slots, redirects and browser-only routers require explicit configured paths.

## Angular, Vue, Svelte, Astro

Use the CLI against the running application, or call `auditPage(page)` in your browser tests. Use `data-glocon-component` and `data-glocon-variant` on your existing components if you want component drift checks. CSS tokens can be used independently. React primitives are not Angular/Vue/Svelte components.

## Electron

Supply a Playwright renderer page from your existing Electron test harness:

```ts
import { _electron as electron } from 'playwright';
import { auditPage, assertUI } from 'glocon/playwright';

const application = await electron.launch({ args: ['.'] });
try {
  const page = await application.firstWindow();
  assertUI(await auditPage(page, { readySelector: 'main', accessibilityMode: 'same-origin' }));
} finally {
  await application.close();
}
```

Electron/OS setup and app lifecycle remain your test harness's responsibility. Electron cannot create the additional browser target used by axe's standard aggregation. The explicit `same-origin` mode uses axe's legacy analysis and reports that cross-origin frames are excluded; `axe/frame-tested` identifies untested frames. Ordinary browser contexts retain standard mode. Do not disable accessibility to work around the unsupported target.

The optional `npm run test:electron` check installs the packed library into an isolated fixture, packages it with ASAR and runs the packaged Linux x64 binary. It verifies renderer currency/time/metered arithmetic, context isolation, invoice/credit retry and SQLite persistence across application restart, narrow layout auditing and detection of an unnamed button. Electron 44.7.0 was verified on 2026-10-08. The verification tools require Node 22.12+, a Linux graphical environment and Xvfb in headless CI; they are installed in a temporary directory and are not consumer dependencies. The fixture's root/headless launch flags do not establish operating-system sandbox coverage. This is representative runtime evidence, not a claim about every Electron application or operating system.

## Browser-only checks

```ts
import { auditDocument } from 'glocon/browser';
const report = auditDocument({ spacingScale: [0, 4, 8, 12, 16, 24, 32] });
```

Call after rendering and styles settle. This runs custom UX/layout checks only. It does not run axe, traverse shadow roots, inspect iframes, or analyze canvas content. Use a real browser; jsdom cannot measure rendered geometry. Closed shadow roots cannot be discovered reliably. The default collection cap is 10,000 elements; reports mark truncation as incomplete and fail by default even at `failOn: "none"`. Set `coveragePolicy: "allow-truncated"` only when partial collection is acceptable; the report retains that limitation.

## React Native / Expo

```ts
import { auditNative } from 'glocon/native';

const report = auditNative([
  {
    testID: 'save',
    accessibilityRole: 'button',
    accessibleName: 'Save profile',
    frame: { x: 16, y: 100, width: 120, height: 48 },
  },
], { width: 390, height: 844 }, { targetSize: 48 });
```

Supply nodes from your test harness, native accessibility tree, or measured layout. `accessibleName` can contain the name computed from children; `accessibilityLabel` is a fallback. `actionable` can override role-based detection. IDs must be unique. Every frame requires finite numeric x, y, width and height; dimensions must be nonnegative. Viewport dimensions must be finite and positive. Frames are in your adapter's layout units, not assumed device pixels. `auditNative` defaults to a 44-unit target heuristic; choose a platform-appropriate threshold explicitly.

This is an adapter API, not an Appium/Detox integration. It does not validate hitSlop, keyboard behavior, screen-reader navigation, or font scaling. Browser web exports from Expo can use the normal browser auditor separately.

The optional `npm run test:native:android` installs the packed library into a fresh Expo 57 fixture and runs it in Expo Go on a selected disposable Android emulator. Set `GLOCON_NATIVE_SERIAL` to the emulator serial and `GLOCON_EXPO_GO_APK` to the official Expo Go 57.0.9 APK. The tools require Node 22.13+, adb and a booted emulator; they are installed in a temporary directory. Android 15, React Native 0.86.2 and static Hermes were verified on 2026-10-08: real measured controls, invoice/credit button presses, remaining-quantity rejection, light/dark appearance and detection of a visible tiny unnamed control. The run also checks large exact currency display and DST behavior. It retains result/events JSON and screenshots; no iOS or standalone production APK coverage is implied.

## Extend the rule engine

```ts
import { auditSnapshot, type Rule } from 'glocon';

const rule: Rule = {
  meta: {
    id: 'project/required-main',
    title: 'Required main region',
    category: 'ux', severity: 'error', confidence: 'high',
    rationale: 'This project requires a main element on every full-page snapshot.',
  },
  check(snapshot) {
    return snapshot.elements.some(element => element.tag === 'main' && element.visible)
      ? []
      : [{ target: 'document', message: 'No visible main element.', evidence: {}, suggestion: 'Render the required main region.' }];
  },
};

const report = auditSnapshot(snapshot, {}, [rule]);
```

`snapshot` is supplied by your collector. Custom rules run only through `auditSnapshot`; the browser CLI does not execute arbitrary config code. Rule IDs must be unique. Rule exceptions throw so a failed check cannot quietly appear as a pass. Keep evidence serializable and avoid including private user content.

## Automation and environment coverage

Use ordinary Playwright projects for browser/viewport/color-scheme matrices, route mocks for network failures, and locators to await the intended state. `auditStates` runs your callbacks sequentially and only checks their declared elements; call `auditPage` separately within a scenario when you want accessibility/layout checks too. It does not automatically reset state between callbacks.

Current CI validates Node 20/22/24 and Chromium, and has a separate Chromium/Firefox/WebKit rendered-page matrix. Clean-installed Vite and Next.js examples exercise setup, baseline/regression handling, loading/retry, financial workflows and Next authentication. ESM/CommonJS, TypeScript and package-manager installation are release checks. Node 20 excludes the built-in SQLite tests; SQLite examples require Node 22.13+. Framework-neutral DOM operation is an architectural compatibility claim, not a claim that every listed framework/version has a dedicated test suite.
