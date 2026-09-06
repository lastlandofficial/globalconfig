# Contributing

Use Node.js 20 or newer. Install dependencies with `npm ci`, install Chromium with `npx playwright install chromium`, then run `npm run check:all`. The repository keeps one npm lockfile; consumers can use npm, pnpm, Bun, or Yarn.

For each new rule, document the user problem, evidence source, exact measurement, severity, confidence, exceptions, and fix. Add a failing example and an intentional passing counterexample. Prefer real browser tests for layout and accessible interaction. Avoid screenshot-only assertions for semantic requirements.

A rule should either observe a concrete defect, test an explicit product contract, or identify itself as a heuristic. Do not add unexplained quality scores or infer absent features from static screenshots. Keep the root engine platform-neutral, React imports isolated, and browser/device limitations explicit.

Public API changes need docs and type checks. Before release, run `npm run check:all`, inspect `npm pack --dry-run`, and install the packed artifact in a fresh consumer. Registry publication is an explicit release action; CI runs verification only.
