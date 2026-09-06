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

## Next: validate the core workflow

- Trial on real React, Angular, Electron, and native projects; measure false positives and usefulness.
- Interaction scenarios for keyboard navigation, focus restoration, retained form values, and recovery.
- Multiple viewport/color-scheme/locale scenario matrices with stable report aggregation.
- Baselines with expiry/reason tracking and reports for newly introduced issues.
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
