# Check what happens after a click

Version 0.5.0 adds interaction scenarios to `glocon check`. Describe a flow once in `glocon.check.json`; glocon runs it in a fresh browser context at every configured screen size, verifies the requested state, then audits that state for UI and accessibility findings.

Start with the existing project workflow:

```sh
npx glocon init --ui
npx glocon check --example
```

The second command prints a page entry with loading, error, retry, and success examples. Copy it into the `pages` array of `glocon.check.json`, replacing the route, selectors, endpoint, and response payloads to match your app. It does not change files or discover your application's behavior. Then run `npx glocon check` locally or in the generated CI workflow.

For example, this checks that a failed save can be retried and keeps the user's input:

```json
{
  "path": "/projects/new",
  "scenarios": [
    {
      "name": "retry preserves project name",
      "mocks": [{
        "path": "/api/projects",
        "method": "POST",
        "responses": [
          { "status": 503, "json": { "message": "Unavailable" } },
          { "json": { "message": "Saved" } }
        ]
      }],
      "steps": [
        { "action": "fill", "selector": "#name", "value": "Launch" },
        { "action": "click", "selector": "#save" },
        { "action": "expect", "selector": "#retry", "state": "visible" },
        { "action": "click", "selector": "#retry" },
        { "action": "expect", "selector": "#status", "text": "Saved" },
        { "action": "expect", "selector": "#name", "value": "Launch" }
      ]
    }
  ]
}
```

This is a **page entry**, not the entire configuration. Keep your existing `baseURL`, `webServer`, `viewports`, and other settings. Use the packaged `glocon/check-config.schema.json` for editor completion, or import `CheckScenario`, `CheckStep`, and `CheckMock` from `glocon/check` in TypeScript.

## Actions and expectations

| Action | Required fields | Behavior |
| --- | --- | --- |
| `click` | `selector` | Waits for an actionable element and clicks it. |
| `fill` | `selector`, `value` | Fills an input, textarea, or editable element; empty strings clear it. |
| `press` | `selector`, `key` | Sends a key such as `Enter`, `Tab`, or `Shift+Tab`. |
| `expect` | `selector`, exactly one of `state`, `text`, `value` | Retries until the assertion passes or `audit.timeout` expires. |

States: `visible`, `hidden`, `enabled`, `disabled`, `focused`. `hidden` also passes when the element is absent. Other expectations require one matching element; ambiguous selectors fail. Text matches `innerText` exactly, including whitespace; value matches the input value exactly. Selectors use Playwright locator syntax. Stable IDs or test IDs make changes easier to maintain.

Server-rendered apps must make controls actionable only after hydration. Disable inputs/buttons until their handlers are attached, or start a scenario with an `expect` step for your app’s explicit readiness marker. Playwright can see server-rendered controls before they are interactive; a successful click alone cannot prove that a handler ran.

Use `press` plus `focused` expectations for keyboard flows, `value` to check retained input, and a success message to verify recovery. Every action has the configured `audit.timeout` budget (30 seconds by default). glocon also bounds each complete scenario run and closes its context on interruption.

A scenario can provide `readySelector` to wait for its final state before the audit. It overrides page and audit readiness settings. Protected pages still verify `auth.readySelector` before the steps run. Existing Playwright test-session setup works unchanged.

## Repeatable API states

Mocks are optional. They intercept browser **fetch and XHR only**, on the configured origin, with an exact pathname and HTTP method (`GET` by default). Query strings are ignored. Other requests proceed normally. These scenarios execute real interactions; use a test app/account and choose mocks for writes you want simulated.

Responses are consumed in order and the last repeats. Every configured response must be used at least once by the end of the audit. A typo in a path or a missing retry therefore produces an incomplete check. Reports show request counts. This is a minimum-use check, not an assertion that no extra requests occurred.

Use `{ "pending": true }` to hold a request until the scenario closes, allowing a deterministic loading-state audit. Use `{ "status": 503, "json": {...} }` for an error, and `{ "json": {...} }` for a 200 response. Empty responses are allowed. Redirect statuses and bodies on HEAD/204/205 responses are rejected. Service workers are blocked in contexts that use mocks so they cannot bypass interception.

Mocks do not cover server-side requests, WebSockets, other browser tabs/popups, or cross-origin services, and do not verify the backend. Keep scenarios scoped to the configured app; navigation outside its origin makes the case incomplete. For complex flows, use the existing `glocon/playwright` API in your own tests.

## Reports, baselines, and coverage

Each scenario runs independently at each viewport. A page with `scenarios` replaces its plain page check; include `{ "name": "default", "steps": [] }` to also audit the initial page. Names must be unique per page. Limits are 20 scenarios per page, 50 steps per scenario, 20 mocks per scenario, and 20 responses per mock.

The report names the page, scenario, and screen, lists passed/failed/not-run steps, and includes normal findings and highlighted screenshots from the final audit. Only the final state is audited. Add separate scenarios for loading, error, and success when each needs UI coverage.

A failed action, unmet expectation, or unused mock response exits **2 (incomplete)**, even with `failOn: "none"`. It cannot be accepted into a baseline. A completed audit with new findings at the configured severity exits **1**. Reviewed findings use the existing reason-and-expiry baseline workflow. Changing a scenario's steps or mocks creates a new case identity; old findings cannot silently carry over. Pages without scenarios keep their 0.4.0 identities.

Step logs and failure messages omit fill values, pressed keys, expected text, expected values, and response payloads. Selectors and scenario names remain visible. Audit evidence and screenshots can contain application content; input masking does not remove text copied elsewhere in the UI. Keep test data and local reports appropriate for sharing.
