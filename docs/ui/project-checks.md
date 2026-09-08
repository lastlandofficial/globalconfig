# Project checks

Available since glocon 0.4.0; interaction scenarios added in 0.5.0. Set up once, then check your running application with one command:

```sh
npx glocon init --ui
npx glocon check
```

Setup detects Next.js, Vite, npm/pnpm/Yarn/Bun, start scripts, and existing Playwright configuration. It adds missing local dependencies, installs Chromium, creates `glocon.check.json`, ignores `.glocon/`, and generates `.github/workflows/glocon.yml` when run at a repository root. The CLI also works from a global `glocon` installation and resolves Playwright from the application directory.

`glocon check` starts your app when needed, checks configured pages and screen sizes, and stops the server it started. It preserves a server that was already running. Review the detected URL and start command, especially if your app has a custom Vite port or starts several services.

## Setup options and repeat runs

```sh
npx glocon init --ui --url http://localhost:3000 --command "npm run dev"
npx glocon init --ui --pages /,/settings,/checkout
npx glocon init --ui --package-manager pnpm
npx glocon init --ui --no-install --no-ci
npx glocon check --dir apps/web
```

For unknown frameworks, provide `--url` or answer the terminal prompt. An app without a start script can use an already-running server or an explicit `--command`. `--no-install` writes configuration and dependency requirements; install them and Chromium before checking. Container images may also need `playwright install --with-deps chromium`.

Setup preserves application scripts, existing configuration, and existing Playwright tests. It adds `glocon:check` only if that script name is free. Re-running setup retries installation and refreshes an untouched generated CI file. A user-edited workflow is preserved. Existing `glocon.check.json` is never reset; edit it directly to change pages or startup settings. Use the same flags, such as `--no-ci`, when repeating setup.

At setup time, static Next.js App Router and Pages Router pages are suggested, including ordinary route groups. Dynamic, private, parallel, and interception route paths are excluded; provide representative URLs explicitly. Vite starts with `/` because client routers are application-specific. Routes are not crawled. Checks perform app actions only when you configure scenario steps.

In a monorepo, run setup in the app directory and use the repository's existing dependency/workspace policy. Generated CI is limited to repository-root applications; add `glocon check` with your app's working directory to existing monorepo CI. Setup does not rewrite an existing Playwright configuration or infer its executable setup hooks.

The original `glocon ui init` still creates standalone `glocon.ui.json` for `glocon audit <url>`. New project setup imports that file's audit options once if present. Subsequent `glocon check` runs use `glocon.check.json`; edit its `audit` field to change project checks. Country configuration remains in `glocon.config.json` and is independent of this workflow.

## Configuration

```json
{
  "version": 1,
  "baseURL": "http://localhost:3000",
  "webServer": {
    "command": "npm run dev",
    "timeout": 60000,
    "reuseExistingServer": true
  },
  "pages": [
    "/",
    { "path": "/settings", "readySelector": "#settings-form" },
    { "path": "/orders/demo-order", "name": "Example order", "auth": true }
  ],
  "viewports": [
    { "name": "phone", "width": 390, "height": 844 },
    { "name": "desktop", "width": 1280, "height": 800 },
    { "name": "dark", "width": 1280, "height": 800, "colorScheme": "dark" }
  ],
  "auth": {
    "storageState": ".glocon/auth.json",
    "loginPath": "/login",
    "readySelector": "[data-testid=account-menu]"
  },
  "audit": { "timeout": 30000, "spacingScale": [0, 4, 8, 12, 16, 24, 32] },
  "failOn": "error",
  "screenshots": true
}
```

Generated configs include a local `$schema` reference for editor completion and validation. The schema is also exported as `glocon/check-config.schema.json`. Runtime validation still checks relationships such as authenticated pages requiring auth configuration.

`baseURL` is an HTTP(S) origin. Pages must be paths on that origin. Credentials and fragments are rejected. Query strings are permitted but omitted from displayed URLs; use a non-sensitive `name` to distinguish cases. The runner does not claim arbitrary redirects are the requested page: redirects to another route produce an incomplete check. Trailing-slash normalization is accepted.

Each page/viewport combination gets an isolated browser context. Color scheme, dimensions, auth requirement, and full configured path distinguish cases. `readySelector` waits for a visible application-specific marker before auditing; set it for asynchronously loaded data. A loaded document alone does not establish that every application state has settled.

All existing audit options can be nested under `audit`: rules, spacing policy, target size, suppressions with reasons, accessibility, timeout, maxElements, and readySelector. Limits: 100 paths, 12 viewports, and dimensions up to 4096 pixels. Browser checks use Chromium; mobile widths do not emulate a native device or its interaction model.

## Pages behind login

Use the application's test authentication. Mark protected pages with `auth: true` and configure a visible marker that only appears after authentication. Public pages use a fresh unauthenticated context.

For local interactive login:

```sh
npx glocon login
```

The command starts/reuses your app and opens Chromium. Log in with a test account, navigate to an authenticated page, and press Enter. glocon verifies the marker before saving cookies and localStorage to the configured storage-state file. The default suggested location, `.glocon/auth.json`, is gitignored; a custom location must also be excluded from version control. State files are saved with restrictive permissions where supported.

If you already use Playwright, point `auth.storageState` at its existing state file. To refresh the session automatically, set `auth.setupCommand` to your existing test setup command, for example:

```json
{
  "auth": {
    "storageState": "playwright/.auth/user.json",
    "readySelector": "[data-testid=account-menu]",
    "loginPath": "/login",
    "setupCommand": "npx playwright test --project=setup"
  }
}
```

The setup command runs once after the app is ready, using the app directory and environment. It must finish and write the state file within two minutes. The command's logs go to stderr. Existing Playwright fixtures, projects, and secrets stay in your test setup; glocon consumes the resulting state. CI can use the same command with test credentials supplied through its existing secret configuration.

Missing state, a failed setup command, HTTP 401/403, a redirect to the configured login page, or a missing authenticated marker makes that protected check incomplete. Public pages still run. `failOn: "none"` never turns incomplete coverage into a pass.

SessionStorage is not automatically restored. For authentication mechanisms needing extra context initialization, continue using `glocon/playwright` with your existing Playwright Page and fixtures. This release does not introduce an authentication provider.

## Reports and exit codes

```sh
npx glocon check --json > check-result.json
```

- `.glocon/report.html`: local, standalone report with grouped findings, evidence, fix guidance, and links to highlighted screenshots.
- `.glocon/report.json`: structured report containing every page/viewport result, new/existing findings, baseline counts, and exit code.
- `.glocon/screenshots/`: annotated viewport images for cases with findings when screenshots are enabled.

Console and HTML reports group repeated rule/target/severity findings while retaining their occurrences and measured evidence. Coverage limits, suppressed findings (in each case's audit report), and incomplete pages remain available. Source file locations are not inferred from DOM selectors.

Exit codes: **0** = no new findings at the threshold and all checks completed; **1** = new findings at the threshold; **2** = incomplete checks or configuration/runtime failure. The default threshold is `error`; `warning`, `info`, and `none` are also supported.

A completed startup or login step is not a successful audit. glocon replaces the previous JSON run before starting, so a failed startup cannot leave yesterday's successful JSON report as the latest run. Server logs go to stderr, leaving `--json` stdout machine-readable.

Screenshots are local and may contain app content even though form fields are masked. Set `screenshots: false` for metadata-only reports. Highlighting covers available light-DOM targets in the current viewport; offscreen, iframe, or shadow-root elements may not be outlined. The report does not execute page-provided HTML or scripts. No reports or screenshots are uploaded automatically, including by generated CI.

## Adopt incrementally with a reviewed baseline

```sh
npx glocon check
# Review the report, then explicitly accept the existing issues:
npx glocon baseline --reason "Existing checkout issues tracked in UI-42" --expires 2026-12-01
npx glocon check
```

Choose a future expiry date. Omitting `--expires` uses 30 days. Commit `glocon.baseline.json` so local and CI runs share the review.

Acceptance requires a complete run from the current UTC day with the same configuration. A check that exits 1 because of findings is eligible; a run with incomplete pages is not. Accepting replaces the baseline with the reviewed findings in that run, including existing findings; it is an explicit renewed review.

Baseline identity includes page, viewport dimensions and color scheme, auth requirement, rule, target, and severity. A severity change or new target is new work. Baselines track issue identity, not every possible change in measured evidence. Expired entries become new findings again; old findings remain visible while valid. Findings absent from completed cases are reported as resolved only when their rule ran. Suppressed findings, disabled rules, truncated or inline-suppressed collection, and skipped or removed cases are not assumed resolved. Checks never silently refresh a baseline.

## Programmatic use (Node.js)

```ts
import { defineCheckConfig, runChecks, formatCheckReport } from 'glocon/check';

const config = defineCheckConfig({
  version: 1,
  baseURL: 'http://localhost:5173',
  webServer: { command: 'npm run dev' },
  pages: ['/'],
  viewports: [{ name: 'phone', width: 390, height: 844 }],
});
const report = await runChecks(config, { dir: process.cwd() });
console.log(formatCheckReport(report));
process.exitCode = report.exitCode;
```

The `glocon/check` subpath is Node-only. React and browser bundles should continue using `glocon/react`, `glocon/browser`, or the platform-neutral `glocon/ui`. Programmatic runs support `signal` for cancellation and write the same report artifacts. Run one check per application directory at a time.

## Verification

The test suite covers setup preservation, route selection, configuration validation, baseline review/expiry, report escaping, authenticated and expired sessions, server reuse, startup failure, cancellation, new regressions, and browser-rendered HTML reports.

`npm run test:frameworks` installs the packed package into fresh React/Vite and Next.js demo applications, executes normal setup twice, starts the apps through glocon, tests their pages across two widths, accepts baselines, introduces defects, and verifies regression failures. The Next.js fixture includes an actual browser test-login flow and expired-session check. These are framework fixtures, not a claim that every production framework configuration has been verified. Their demo login is not production authentication code.

## Interaction scenarios (0.5.0)

Add named `scenarios` to page entries to exercise loading, error, retry, and success flows before auditing. Run `glocon check --example` for a starter page entry. [Read the scenario guide](scenarios.md) for actions, expectations, API mocks, isolation, and baseline behavior. Existing page-only configurations need no migration.
