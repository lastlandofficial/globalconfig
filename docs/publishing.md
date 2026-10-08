# Distribution and publishing

This checkout is a 0.7.0 release candidate. As verified on 2026-10-08, npm latest is 0.5.0 and GitHub has the financial 0.6.0 tarball. Do not describe 0.7.0 as publicly available until `npm run check:distribution` passes.

## Public distribution without an npm account

The GitHub release contains the output of `npm pack`: compiled ESM/CommonJS, declarations, documentation, and license. npm, pnpm, Yarn, and Bun can install that public `.tgz` URL. No registry account, custom registry, package-manager plugin, or consumer build script is required.

The original GitHub v0.1.0 tarball uses the unscoped name `globalconfig`; its imports remain unscoped. The scoped npm release `@lastlandofficial/globalconfig@0.1.0` was unpublished. The earlier `globalconfigurations@0.1.0` release was also unpublished. The current package name is `glocon`.

Keep release URLs versioned and immutable. Do not replace `v0.1.0` assets with different code. A later change gets a new package version and release tag. The source repository intentionally does not track `dist`, so install a release asset rather than the Git repository directly.

## Publish to the npm registry

The project is named **globalconfig** and its npm package name is `glocon`. npm publication requires an account with permission to publish that name and two-factor authentication for interactive publishing. Bun, pnpm, and Yarn use the same published npm package. For subsequent releases, increase the package version before publishing.

Before publishing, review the source commit and confirm its eight CI jobs pass, including packaged Electron and Android/Hermes. The release candidate manifest records the archive sha512 integrity, source-tree hash and completed validation. Rebuild and refresh that manifest whenever source or packaged documentation changes.

From a clean checkout:

```sh
npm ci
npm run check:all
npm run test:frameworks
npm login
npm publish --access public
npm run check:distribution
```

The `prepublishOnly` hook runs the full checks, framework examples and dependency audit again, and `prepack` rebuilds the package. Perform login locally; never put an npm token in source files or share it in an issue. After publication, verify:

```sh
npm view glocon version
npm install glocon
pnpm add glocon
yarn add glocon
bun add glocon
```

## Create a later GitHub release

1. Update the version, lockfile, changelog, and versioned installation links.
2. Run `npm ci`, `npm run check`, and `npm pack`.
3. Commit the reviewed source and push it to the public repository.
4. Create a GitHub release tagged `glocon-v<version>` and attach `glocon-<version>.tgz` with release notes.
5. Install the public release URL in fresh consumer projects with the supported package managers.

CI runs engineering tests and verifies public installation after a GitHub release or manual workflow dispatch. It does not publish to npm or create releases automatically. The distribution gate checks the current version is the latest registry tag, validates the public tarball sha512 digest, installs the default `glocon` spec in a fresh directory, and exercises financial exports and the CLI. Publishing credentials remain an external release requirement.

Reference: [npm installation sources](https://docs.npmjs.com/cli/install/) and [Bun package installation](https://bun.com/docs/pm/cli/add).
