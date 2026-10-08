# Project checks

This guide describes the 0.7.0 release candidate; project checks were introduced in 0.4.0 and scenarios in 0.5.0. [Install the candidate](../../README.md#install) and verify its local version. Set up once, then check your running application with one command:

```sh
npx --no-install glocon init --ui
npx --no-install glocon check
```

Setup detects Next.js, Vite, npm/pnpm/Yarn/Bun, start scripts, and existing Playwright configuration. It adds missing local dependencies, installs Chromium, creates `glocon.check.json`, ignores `.glocon/`, and generates `.github/workflows/glocon.yml` when run at a repository root. The CLI also works from a global `glocon` installation and resolves Playwright from the application directory.

`glocon check` starts your app when needed, checks configured pages and screen sizes, and stops the server it started. It preserves a server that was already running. Review the detected URL and start command, especially if your app has a custom Vite port or starts several services.

## Setup options and repeat runs

```sh
npx --no-install glocon init --ui --url http://localhost:3000 --command "npm run dev"
npx --no-install glocon init --ui --pages /,/settings,/checkout
npx --no-install glocon init --ui --package-manager pnpm
npx --no-install glocon init --ui --no-install --no-ci
npx --no-install glocon init --ui --ci-artifacts --artifact-retention-days 7
npx --no-install glocon init --ui --ci-artifacts --ci-screenshots
npx --no-install glocon check --dir apps/web
```

For unknown frameworks, provide `--url` or answer the terminal prompt. An app without a start script can use an already-running server or an explicit `--command`. `--no-install` writes configuration and dependency requirements; install them and Chromium before checking. Container images may also need `playwright install --with-deps chromium`.

Setup preserves application scripts, existing configuration, and existing Playwright tests. It adds `glocon:check` only if that script name is free. Re-running setup retries installation and refreshes an untouched generated CI file. A user-edited workflow is preserved. Existing `glocon.check.json` is never reset; edit it directly to change pages or startup settings. Use the same flags, such as `--no-ci`, when repeating setup.

At setup time, static Next.js App Router and Pages Router pages are suggested, including ordinary route groups. Dynamic, private, parallel, and interception route paths are excluded; provide representative URLs explicitly. Vite starts with `/` because client routers are application-specific. Routes are not crawled. Checks perform app actions only when you configure scenario steps.

In a monorepo, run setup in the app directory and use the repository's existing dependency/workspace policy. Generated CI is limited to repository-root applications; add `glocon check` with your app's working directory to existing monorepo CI. Setup does not rewrite an existing Playwright configuration or infer its executable setup hooks.

The original `glocon ui init` still creates standalone `glocon.ui.json` for `glocon audit <url>`. New project setup imports that file's audit options once if present. Subsequent `glocon check` runs use `glocon.check.json`; edit its `audit` field to change project checks. Country configuration remains in `glocon.config.json` and is independent of this workflow. If a standalone config has `expectedURL`, migration retains that reviewed destination for a single page. Explicit multiple `--pages` or a cross-origin expectation needs manual reconciliation; setup does not silently drop the destination check.

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
  "screenshots": true,
  "concurrency": 2,
  "runTimeout": 180000
}
```

Generated configs include a local `$schema` reference for editor completion and validation. The schema is also exported as `glocon/check-config.schema.json`. Runtime validation still checks relationships such as authenticated pages requiring auth configuration.

`baseURL` is an HTTP(S) origin. Pages must be paths on that origin. Credentials and fragments are rejected. Query strings are permitted but omitted from displayed URLs; use a non-sensitive `name` to distinguish cases. By default the final destination must match the requested page. For an intentional redirect, give the page an `expectedURL` such as `{ "path": "/old-settings", "expectedURL": "/settings", "readySelector": "#settings-form" }`. It accepts an absolute HTTP(S) URL on `baseURL` or a path on that origin, including query/fragment. The runner checks origin, normalized path, exact query and fragment; a trailing slash is tolerated. Unreviewed redirects are incomplete. Scenario navigation can declare its own final destination as described in the [scenario guide](scenarios.md).

Each page/viewport combination gets an isolated browser context. `concurrency` accepts 1–12 workers and defaults to 2. Cases run concurrently, while the final report retains configuration order. An optional `runTimeout` (1–86,400,000 milliseconds) bounds the entire run from startup and authentication through the last case. Each case also has a shared `audit.timeout` budget covering navigation, readiness, authentication, steps, collection and accessibility analysis; one slow phase cannot obtain a fresh full budget for every subsequent phase. Color scheme, dimensions, auth requirement, and full configured path distinguish cases. `readySelector` waits for a visible application-specific marker before auditing; set it for asynchronously loaded data. A loaded document alone does not establish that every application state has settled.

All existing audit options can be nested under `audit`: rules, spacing policy, target size, suppressions with reasons, accessibility, timeout, maxElements, and readySelector. Limits: 100 paths, 12 viewports, and dimensions up to 4096 pixels. Browser checks use Chromium; mobile widths do not emulate a native device or its interaction model.

## Pages behind login

Use the application's test authentication. Mark protected pages with `auth: true` and configure a visible marker that only appears after authentication. Public pages use a fresh unauthenticated context.

For local interactive login:

```sh
npx --no-install glocon login
```

The command starts/reuses your app and opens Chromium. Log in with a test account, navigate to an authenticated page, and press Enter. glocon verifies the marker before saving cookies and localStorage to the configured storage-state file. The default suggested location, `.glocon/auth.json`, is gitignored; a custom location must also be excluded from version control. State files are saved with restrictive permissions where supported.

If you already use Playwright, point `auth.storageState` at its existing state file. To refresh the session automatically, set `auth.setupCommand` to your existing test setup command, for example:

```json
{
  "auth": {
    "storageState": "playwright/.auth/user.json",
    "readySelector": "[data-testid=account-menu]",
    "loginPath": "/login",
    "setupCommand": "npx --no-install playwright test --project=setup"
  }
}
```

The setup command runs once after the app is ready, using the app directory and environment. It must finish and write the state file within two minutes. The command's logs go to stderr. Existing Playwright fixtures, projects, and secrets stay in your test setup; glocon consumes the resulting state. CI can use the same command with test credentials supplied through its existing secret configuration.

Missing state, a failed setup command, HTTP 401/403, a redirect to the configured login page, or a missing authenticated marker makes that protected check incomplete. Public pages still run. `failOn: "none"` never turns incomplete coverage into a pass.

SessionStorage is not automatically restored. For authentication mechanisms needing extra context initialization, continue using `glocon/playwright` with your existing Playwright Page and fixtures. This release does not introduce an authentication provider.

## Reports and exit codes

```sh
npx --no-install glocon check --json > check-result.json
```

- `.glocon/report.html`: local, standalone report with grouped findings, evidence, fix guidance, and links to highlighted screenshots.
- `.glocon/report.json`: structured report containing every page/viewport result, new/existing findings, baseline counts, and exit code.
- `.glocon/screenshots/`: annotated viewport images for cases with findings when screenshots are enabled.

Console and HTML reports group repeated rule/target/severity findings while retaining their occurrences and measured evidence. Coverage limits, suppressed findings (in each case's audit report), and incomplete pages remain available. Source file locations are not inferred from DOM selectors.

Exit codes: **0** = no new findings at the threshold and all checks completed; **1** = new findings at the threshold; **2** = incomplete checks or configuration/runtime failure. The default threshold is `error`; `warning`, `info`, and `none` are also supported.

A completed startup or login step is not a successful audit. glocon replaces the previous JSON run before starting, so a failed startup cannot leave yesterday's successful JSON report as the latest run. Server logs go to stderr, leaving `--json` stdout machine-readable.

Screenshots are local and may contain app content even though form fields are masked. Set `screenshots: false` for metadata-only reports. Highlighting covers available light-DOM targets in the current viewport; offscreen, iframe, or shadow-root elements may not be outlined. The report does not execute page-provided HTML or scripts. Generated CI uploads nothing by default. `init --ui --ci-artifacts` explicitly enables uploading only `.glocon/report.html` and `.glocon/report.json`, including failure results. Retention defaults to 7 days; `--artifact-retention-days` accepts 1–90 and requires artifact opt-in. `--ci-screenshots` additionally permits screenshot PNG uploads and requires artifact opt-in and enabled screenshot capture. Auth state is always excluded. `--no-screenshots` disables capture when creating a config; existing configs remain preserved and must be edited deliberately. Rerun setup with the same artifact flags to retain the generated preference. Reports may still contain application-specific selectors/evidence, and screenshots may contain application content; review your test data before opting in.

## Adopt incrementally with a reviewed baseline

```sh
npx --no-install glocon check
# Review the report, then explicitly accept the existing issues:
npx --no-install glocon baseline --reason "Existing checkout issues tracked in UI-42" --expires 2026-12-01
npx --no-install glocon check
```

Choose a future expiry date. Omitting `--expires` uses 30 days. Commit `glocon.baseline.json` so local and CI runs share the review.

Acceptance requires a complete run from the current UTC day with the same configuration. A check that exits 1 because of findings is eligible; a run with incomplete pages is not. Accepting renews the review for observed findings in that complete run, including existing findings. Unresolved entries that the run did not observe are retained with their original reason, review date and expiry; only proven resolved entries are pruned.

Baseline identity includes page, explicitly reviewed destination, viewport dimensions and color scheme, auth requirement, scenario definition, rule, target, and severity. A severity change or new target is new work. Baselines track issue identity, not every possible change in measured evidence. Expired entries become new findings again; old findings remain visible while valid. Findings absent from completed cases are reported as resolved only when an explicit passing coverage outcome establishes that their rule/target passed. Passing proof is an exact rule/target outcome, as supplied by axe, or an explicit clean applicable custom-rule pass with the old target still present in `coverage.targets`. A listed rule, inapplicable/removed axe target, empty outcomes array or manual-review result does not establish a pass. Historical reports without an outcomes field retain their compatibility fallback. Suppressed findings, disabled rules, truncated or inline-suppressed collection, and skipped or removed cases are not assumed resolved. Checks never silently refresh a baseline. Removed cases and findings without passing proof keep their prior review metadata when a new baseline is saved. A clean applicable custom rule can establish resolution only for prior targets still collected in `coverage.targets`; removed/unobserved targets cannot be resolved from a rule-wide pass. Deliberately retired cases/targets without passing proof require an explicit baseline edit rather than being labelled resolved.

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
const report = await runChecks(config, {
  dir: process.cwd(),
  onProgress: ({ completed, total, status }) => {
    console.error(`${completed}/${total} completed: ${status}`);
  },
});
console.log(formatCheckReport(report));
process.exitCode = report.exitCode;
```

The `glocon/check` subpath is Node-only. React and browser bundles should continue using `glocon/react`, `glocon/browser`, or the platform-neutral `glocon/ui`. Programmatic runs support `signal` for cancellation and `onProgress({ completed, total, caseId, status })` callbacks in completion order. Callback failures warn once on stderr without aborting the checks. The CLI prints progress to stderr and preserves machine-readable `--json` stdout; `--quiet` hides progress.

An exclusive `.glocon/check.lock` protects reports, screenshots and app lifecycle from overlapping runs in one application directory. A second run fails before touching the first run's artifacts or server. Normal completion, cancellation and run deadlines release only the run's own lock. A hard-killed process can leave a lock behind; verify no run is active before removing the stale file. Screenshots are cleared at the beginning of each locked run, so opted-in CI artifacts cannot accidentally upload images from a previous run.

## Verification

The test suite covers setup preservation, route selection, configuration validation, baseline review/expiry, report escaping, authenticated and expired sessions, server reuse, startup failure, cancellation, new regressions, and browser-rendered HTML reports.

`npm run test:frameworks` installs the packed package into fresh React/Vite and Next.js demo applications, executes normal setup twice, starts the apps through glocon, tests their pages across two widths, accepts baselines, introduces defects, and verifies regression failures. The Next.js fixture includes an actual browser test-login flow and expired-session check. These are framework fixtures, not a claim that every production framework configuration has been verified. Their demo login is not production authentication code.

## Interaction scenarios (0.5.0)

Add named `scenarios` to page entries to exercise loading, error, retry, and success flows before auditing. Run `glocon check --example` for a starter page entry. [Read the scenario guide](scenarios.md) for actions, expectations, API mocks, isolation, and baseline behavior. Existing page-only configurations need no migration.
