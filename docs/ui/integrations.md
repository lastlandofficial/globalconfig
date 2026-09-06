# Integration guide

## Package entry points

| Import | Exports / purpose | Runtime requirement |
| --- | --- | --- |
| `glocon` | `auditSnapshot`, `rules`, `defineContract`, `checkContract`, `createReport`, `formatReport`, `fingerprint`, `shouldFail`, types | JS runtime |
| `glocon/browser` | `collectSnapshot`, `auditDocument` | Browser DOM and layout |
| `glocon/playwright` | `auditPage`, `auditStates`, `assertUI`, `matchers` | Node.js, Playwright Page, installed browser |
| `glocon/react` | `Button`, `Field`, `Status`, `EmptyState`, `AsyncState`, `Stack` and props | React 18/19 |
| `glocon/native` | `fromNativeNodes`, `auditNative`, types | Supplied measured native nodes |
| `glocon/styles.css` | Component styles and tokens | CSS pipeline or browser |
| `glocon/tokens.css` | Tokens only | CSS pipeline or browser |

## Next.js / TanStack Start

Audit the running application URL or use a Playwright test with your existing authenticated context. Wait for the actual application state before scanning. Add React primitives inside client components where interactive handlers or client state are needed. The `glocon/react` bundle preserves its `use client` directive; the root audit engine imports neither React nor browser globals. Import CSS in the location supported by your framework, such as an application root layout.

No Next.js or TanStack plugin is necessary for runtime auditing. Source-code analysis and automatic route discovery are not included.

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
  assertUI(await auditPage(page, { readySelector: 'main' }));
} finally {
  await application.close();
}
```

Electron/OS setup and app lifecycle remain your test harness's responsibility. Chromium browser fixtures are exercised in this repository; a packaged Electron application is not part of the 0.3.0 test matrix.

## Browser-only checks

```ts
import { auditDocument } from 'glocon/browser';
const report = auditDocument({ spacingScale: [0, 4, 8, 12, 16, 24, 32] });
```

Call after rendering and styles settle. This runs custom UX/layout checks only. It does not run axe, traverse shadow roots, inspect iframes, or analyze canvas content. Use a real browser; jsdom cannot measure rendered geometry. Closed shadow roots cannot be discovered reliably. The default collection cap is 10,000 elements; reports disclose truncation.

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

Supply nodes from your test harness, native accessibility tree, or measured layout. `accessibleName` can contain the name computed from children; `accessibilityLabel` is a fallback. `actionable` can override role-based detection. IDs must be unique. Frames are in your adapter's layout units, not assumed device pixels. `auditNative` defaults to a 44-unit target heuristic; choose a platform-appropriate threshold explicitly.

This is an adapter API, not an Appium/Detox integration. It does not validate hitSlop, keyboard behavior, screen-reader navigation, or font scaling. Browser web exports from Expo can use the normal browser auditor separately.

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

Version 0.3.0 CI validates Node 20/22/24 and Chromium. ESM/CommonJS and package-manager installation are release checks. Framework-neutral DOM operation is an architectural compatibility claim, not a claim that every listed framework/version has a dedicated test suite.
