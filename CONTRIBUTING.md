# Contributing

## Product focus

The current supported workflows are UI regression checks, reviewed tax/invoice drafts, and country utilities. Improve the work developers actually perform in those paths before adding more frameworks, jurisdictions or services. Ship useful, tested capabilities and distinguish implementation from roadmap ideas. Authentication remains future scope. React, Next.js, React Native, Electron and Node.js share a framework-independent core where their runtime capabilities permit it.

For adoption claims, follow the [independent trial protocol](docs/readiness-trials.md). Automated fixtures prove the tested behavior; independent application trials are needed for usability, usefulness and finding-accuracy claims.

- Connect legal and tax guidance to official government sources, explicit scope, and relevant dates.
- Turn reviewed requirements into concrete implementation steps, useful helpers, and evidence developers can test and retain.
- Keep unanswered applicability questions visible. Do not replace missing facts with assumptions or present recorded progress as legal certification.
- Prefer less repeated configuration and clear errors. CLI tools and adapters should reduce integration work while keeping the core portable.
- Test generated integrations and public package exports; distinguish verified environments from intended runtime support.

## Development

Use Node.js 20.11+ and npm to work on the repository. Consumers require Node.js 20.3+; development tooling has the higher minimum. The checked-in npm lockfile is the canonical development dependency lock; consumers may use any compatible package manager.

```sh
npm ci
npx --no-install playwright install chromium
npm run check:all
npm run check:docs
```

Code lives in `src/`, behavior tests in `test/` and `tests/`, and documentation in `docs/`. Built files and release tarballs are generated, not committed. Keep ESM and CommonJS exports aligned. New public behavior needs TypeScript types, examples, runtime validation for JavaScript callers, and meaningful tests.

`npm run test:browser:matrix` runs the rendered-page suite in Chromium, Firefox and WebKit after installing those browsers and their system libraries. `xvfb-run --auto-servernum npm run test:electron` verifies a packaged Linux application and requires Node 22.12+ for its isolated packaging tools. These optional verification dependencies are separate from the package's Node 20.3 consumer requirement.

`npm run test:native:android` prepares an isolated Expo 57 fixture. Use Node 22.13+, a disposable running Android emulator, and the matching [Expo Go 57.0.9 APK](https://github.com/expo/expo-go-releases/releases/tag/Expo-Go-57.0.9). Set `GLOCON_NATIVE_SERIAL` to that emulator's serial and `GLOCON_EXPO_GO_APK` to the downloaded APK path. The script checks real measured controls, on-device Hermes currency/time/financial behavior, partial credits, dark appearance and deliberate defects. It does not select physical devices. Native CI requires hardware acceleration; the local software-emulation boot attempt timed out before the fixture ran.

For tax or legal changes, use official sources, record review/effective dates, and explain jurisdiction and applicability limits. Never silently infer an unknown legal fact, tax rate, US time zone, or exchange quote. See [coverage and source policy](docs/coverage.md).

Version public API changes and rule-data updates deliberately. Add countries only when their country metadata, money precision, tax scope, legal sources, and behavior tests have been reviewed together.

UI components, adapters, rules, and state contracts live in `src/ui/`. Preserve optional React and Playwright peers, scoped CSS, client component boundaries, accessible behavior, evidence, and explicit audit limitations.

Before changing onboarding instructions or public types, run the documentation/schema checks and keep README, API reference and `llms.txt` aligned. Release evidence should be generated with `npm run release:verify` after the final edits; record only checks executed for that exact source tree. See [publishing](docs/publishing.md) for the candidate archive and additional platform evidence.
