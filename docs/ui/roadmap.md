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

## Next: deepen verified workflows

- Trial on real React, Angular, Electron, and native projects; measure false positives and usefulness.
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

No dates or support claims are implied for unimplemented items. Release 0.3.0 is a foundation, not complete automated UX testing.
