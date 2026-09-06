# glocon

**Turn the testable parts of UI and UX into code.**

`glocon` is a testing library and a small UI library for JavaScript and TypeScript developers. Audit an existing app, detect measurable inconsistencies, declare missing-state requirements, and build common controls with better defaults. Findings explain **what happened, where, why it matters, and what to change**.

Version **0.3.0**. MIT licensed. Local execution. No account, telemetry, API key, or LLM required.

```sh
npm install glocon
# or
pnpm add glocon
bun add glocon
yarn add glocon
```

## Audit your existing app

For browser audits, install the optional Playwright runner and its browser once:

```sh
npm install -D playwright
npx playwright install chromium

# Start your app in another terminal, then:
npx glocon audit http://localhost:3000 --ready 'main'
npx glocon audit http://localhost:3000 --viewport 390x844 --json
```

With other package managers, use `pnpm exec glocon`, `bunx glocon`, or `yarn glocon` after installing the package. Install Playwright using your chosen manager as well.

```text
WARNING form/error-description [medium]
  #email: Invalid field has no readable linked error or description.
  Fix: Render a specific error message and associate its ID using
       aria-describedby or aria-errormessage. Preserve the entered value.
```

The CLI runs axe accessibility checks and additional UX/layout checks. By default only errors fail the command. Use `--fail-on warning` for stricter CI, or `--fail-on none` for discovery. Exit codes: **0** passed, **1** findings at your threshold, **2** configuration/runtime failure.

```sh
npx glocon ui init
npx glocon doctor .
npx glocon rules --json
npx glocon audit http://localhost:3000 --config glocon.ui.json --json --output report.json
```

Use `--ready` for applications that hydrate or load asynchronously. A URL audit checks one page, viewport, and observed state; it does not crawl every route or exercise your flows.

## Use your existing Playwright tests

```ts
import { test, expect } from '@playwright/test';
import { auditPage, assertUI } from 'glocon/playwright';

test('settings are usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3000/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const report = await auditPage(page);
  assertUI(report); // throws with findings if errors exist
});
```

The existing `Page` preserves your authentication, routes, network mocks, browser engine, and test setup. Optional `matchers` can be registered with `expect.extend(matchers)`; `assertUI` needs no matcher type augmentation.

## Test UI that should exist

A screenshot cannot tell whether your product needs a retry action. A **state contract** can.

```ts
import { defineContract } from 'glocon';
import { auditStates, assertUI } from 'glocon/playwright';

const orders = defineContract({
  name: 'orders',
  states: {
    loading: { required: [
      { selector: '[role="status"]', description: 'loading feedback' },
    ] },
    empty: { required: [
      { selector: '[data-testid="create-order"]', description: 'a first-order action' },
    ] },
    error: { required: [
      { selector: '[data-testid="retry"]', description: 'a retry action' },
    ] },
  },
});

// Inside a test, using app-owned scenario routes or network mocks:
const report = await auditStates(page, orders, {
  loading: async page => {
    await page.goto('http://localhost:3000/orders?fixture=loading');
    await page.locator('[data-testid="orders-ready"]').waitFor();
  },
  error: async page => {
    await page.goto('http://localhost:3000/orders?fixture=error');
    await page.locator('[data-testid="orders-ready"]').waitFor();
  },
});
assertUI(report);
```

These example fixture URLs and readiness markers must be implemented by your app. Each setup callback must enter and await the intended state. Each scenario should reset any state it depends on.

- Observed error state without the declared retry action → **error: missing UI**.
- Empty state not exercised → **warning: untested state**.
- A selector that was never measured in a supplied core observation → invalid input, not invented evidence.

`checkContract(contract, observations)` provides the same checks without a browser, so other test harnesses can supply their own visible-element counts. Contracts assert visibility and count; add interaction assertions to verify that actions work.

## Prevent common omissions with React primitives

React 18 and 19 are optional peers. Import components separately so non-React apps do not load React.

```tsx
import { AsyncState, Button, EmptyState, Field, Status } from 'glocon/react';
import 'glocon/styles.css';

<Field
  label="Email address"
  type="email"
  autoComplete="email"
  hint="Use your work email."
  error={errors.email}
  value={email}
  onChange={event => setEmail(event.target.value)}
/>

<Button pending={saving} pendingLabel="Saving changes…" onClick={save}>
  Save changes
</Button>

<AsyncState
  value={orders}
  views={{
    loading: <Status>Loading orders…</Status>,
    empty: <EmptyState title="No orders yet" description="Create an order to get started." />,
    error: error => <Status tone="error">{error.message}</Status>,
    success: data => <OrderList orders={data} />,
  }}
/>
```

`orders` uses the exported `AsyncValue<T>` union: `loading`, `empty`, `error` with an `Error`, or `success` with `data`. TypeScript requires all four renderers. The library does not own fetching, validation timing, or application state.

`Button` defaults to `type="button"`; use `type="submit"` deliberately. Pending buttons stay focusable and block repeat activation. `Field` connects visible labels, hints, and error messages. Keep `Status` mounted and update its contents when you need reliable announcements. Screen-reader testing is still necessary.

Styles are opt-in and scoped to `glocon-*` classes. Override CSS custom properties to fit your design system, or import only `glocon/tokens.css`. Set `data-glocon-theme="dark"` on a containing element to use dark tokens. Tokens do not change your app's body background automatically.

## Configure your own design policy

```json
{
  "viewport": { "width": 390, "height": 844 },
  "failOn": "error",
  "spacingScale": [0, 4, 8, 12, 16, 24, 32, 48, 64],
  "spacingTolerance": 0.5,
  "rules": { "consistency/spacing": "info" },
  "suppressions": [
    {
      "ruleId": "interaction/target-size",
      "target": "#map-pin",
      "reason": "Map geometry is intentional; the location list provides an equivalent larger control."
    }
  ]
}
```

Spacing is not checked unless you supply a scale. Component drift is checked only among elements explicitly marked with the same component and variant:

```html
<button data-glocon-component="Button" data-glocon-variant="primary">Save</button>
```

At least three peers and a strict majority are required. This is a suggestion to investigate, not a requirement that everything look the same. See [all rules and limitations](rules.md).

## Framework support in 0.3.0

| Environment | Available today |
| --- | --- |
| React, Next.js, TanStack Start | Rendered browser audits, state contracts, optional React primitives |
| Angular, Vue, Svelte, Astro, plain HTML | Rendered browser audits, state contracts, shared CSS; no dedicated component bindings |
| Electron | Pass an Electron renderer `Page` from Playwright to `auditPage`; no app launcher included |
| React Native / Expo native | Supply measured nodes to `glocon/native`; no automatic device-tree collection or native components |
| Node.js | Pure snapshot engine, contracts, report formatting, and CLI; Node.js itself has no rendered UI |
| Browser JS | `auditDocument` from `glocon/browser` for synchronous UX/layout checks; this entry does not run axe |

ES modules, CommonJS, and TypeScript declarations are included. The glocon/ui, browser, and native imports have no runtime dependency imports; the Playwright subpath loads the installed axe integration. Browser installation and React remain optional. See [integration details](integrations.md).

## For coding agents and CI

```sh
npx glocon audit http://localhost:3000 --json --output report.json
```

Reports contain stable rule IDs, severity, confidence, target, observed evidence, suggested fixes, source links where available, suppressions, and coverage limitations. The [JSON schema](report.schema.json) and [llms.txt](llms.txt) describe the contract. Fingerprints identify rule/target pairs within a source; DOM restructuring can change selector-based identity.

No screenshots, raw HTML, entered form values, or page text are included by the built-in web reporter. URL query strings and fragments are omitted. URLs, selectors, custom-rule evidence, and native snapshots can still contain application-specific data; inspect reports before sharing them. There is no report upload service.

## Why these checks?

The [research report](research.md) connects community complaints with primary accessibility and usability sources, then explains the automation boundary. The [roadmap](roadmap.md) separates shipped features from planned work.

A clean report means **no findings from the checks and states executed**. It does not certify accessibility, discover every missing feature, or grade visual taste. Manual evaluation and user research remain essential.

## Develop and contribute

```sh
npm install
npx playwright install chromium
npm run check
npm pack
```

`npm run check:all` type-checks, runs unit tests, builds every export, and runs real Chromium tests. Browser tests use a local fixture server. `node scripts/fixture-server.mjs` serves the component workbench at `http://127.0.0.1:4179/react`.

New rules should include a clear rationale, concrete evidence, meaningful broken and passing examples, intentional exceptions, and honest confidence. Read [CONTRIBUTING.md](CONTRIBUTING.md).
