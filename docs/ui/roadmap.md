# Roadmap

## Shipped in 0.3.0

- Framework-neutral snapshot engine and extensible rule interface.
- Explainable findings, configurable severity, reasoned report suppressions, deterministic fingerprints, and JSON schema.
- Browser collection, Playwright/axe integration, assertions, and URL-audit CLI.
- Explicit UX-state contracts with missing-versus-untested distinction.
- React Button, Field, Status, EmptyState, AsyncState, and Stack primitives.
- Opt-in CSS tokens and dark-theme overrides.
- Measured-node native adapter.
- Research rationale, integration examples, automated tests, and CI.

## Shipped in 0.4.0

- Framework-aware setup, dependency/browser installation, and generated CI.
- Managed app startup and checks across configured pages, screen sizes, and color schemes.
- Test-session reuse, interactive capture, and explicit expired-login coverage.
- Reviewed baselines with reasons, expiry, and new-regression detection.
- Grouped HTML/JSON reports and highlighted local screenshots.
- Clean-install React/Vite and Next.js framework fixtures.

## Shipped in 0.5.0

- Named interaction scenarios in the existing project-check command.
- Click, fill, key press, and retrying assertions for visibility, enabled state, focus, text, and retained values.
- Same-origin browser API response sequences and pending requests for repeatable loading/error/retry/success checks.
- Isolated scenario/viewport contexts, step outcomes and mock counts, and scenario-aware baselines.
- Copyable CLI examples, editor schema, and clean-installed Next.js/React/Vite scenario verification.

## Prepared in 0.7.0 (release candidate)

- Reject unexpected standalone audit redirects and incomplete DOM collection by default.
- Require complete native measurement data.
- Preserve package sources on setup, make accessibility tooling optional for utility consumers, and verify public default installs after releases.
- Require financial quote/invoice acceptance scope and independently reviewed expected amounts.
- Expand automated browser checks across Chromium, Firefox and WebKit, and record representative packaged Linux Electron and Android/Hermes verification.
- Bound complete audit/run deadlines, execute cases with limited concurrency, preserve reviewed destinations through scenario navigation and migration, and protect artifacts from overlapping runs.
- Record explicit passing/failing/manual-review coverage outcomes; resolve baselines only from observed passing evidence.
- Make CI report artifacts an explicit opt-in, with separate screenshot permission and bounded retention.
- Provide three onboarding paths, aligned API documentation and a [predeclared independent-trial protocol](../readiness-trials.md).

## Next: deepen verified workflows

- Run the separate UI and financial application trials before broadening framework or jurisdiction claims. Recruit independent developers and relevant business reviewers; measure help required, actionable findings and adoption value.
- Locale matrices and deeper multi-page interaction workflows.
- Trial baseline usefulness and false-positive rates in production applications.
- Source locations from framework metadata, without pretending DOM selectors identify source lines.
- SARIF and editor integration after source mapping is reliable.

## Later: wider platform and authoring support

- Native device collectors and React Native components with platform testing.
- Dedicated Angular/Vue bindings where they reduce integration work.
- Storybook integration for state coverage.
- Design-token format import/export.
- MCP/editor integrations if validated workflows benefit beyond CLI JSON and llms.txt.
- Static framework analysis for likely state omissions, explicitly reported as inference.

No dates or support claims are implied for unimplemented items. The toolkit remains a foundation for measured checks and explicitly authored scenarios. Independent trials and native-device coverage are still required before broader readiness claims.
