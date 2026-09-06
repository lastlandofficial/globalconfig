# Contributing

Use Node.js 20+ and npm to work on the repository. The checked-in npm lockfile is the canonical development dependency lock; consumers may use any compatible package manager.

```sh
npm ci
npm run check
```

Code lives in `src/`, behavior tests in `test/`, and documentation in `docs/`. Built files and release tarballs are generated, not committed. Keep ESM and CommonJS exports aligned. New public behavior needs TypeScript types, examples, runtime validation for JavaScript callers, and meaningful tests.

For tax or legal changes, use official sources, record review/effective dates, and explain jurisdiction and applicability limits. Never silently infer an unknown legal fact, tax rate, US time zone, or exchange quote. See [coverage and source policy](docs/coverage.md).

Version public API changes and rule-data updates deliberately. Add countries only when their country metadata, money precision, tax scope, legal sources, and behavior tests have been reviewed together.
