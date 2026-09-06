# Distribution and publishing

## Public distribution without an npm account

The GitHub release contains the output of `npm pack`: compiled ESM/CommonJS, declarations, documentation, and license. npm, pnpm, Yarn, and Bun can install that public `.tgz` URL. No registry account, custom registry, package-manager plugin, or consumer build script is required.

The original GitHub v0.1.0 tarball uses the unscoped name `globalconfig`; its imports remain unscoped. The scoped npm release `@lastlandofficial/globalconfig@0.1.0` was unpublished. The earlier `globalconfigurations@0.1.0` release was also unpublished. The current package name is `glocon`.

Keep release URLs versioned and immutable. Do not replace `v0.1.0` assets with different code. A later change gets a new package version and release tag. The source repository intentionally does not track `dist`, so install a release asset rather than the Git repository directly.

## Publish to the npm registry

The project is named **globalconfig** and its npm package name is `glocon`. npm publication requires an account with permission to publish that name and two-factor authentication for interactive publishing. Bun, pnpm, and Yarn use the same published npm package. For subsequent releases, increase the package version before publishing.

From a clean checkout:

```sh
npm ci
npm run check
npm login
npm publish --access public
```

The `prepublishOnly` hook runs the checks again, and `prepack` rebuilds the package. Perform login locally; never put an npm token in source files or share it in an issue. After publication, verify:

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
4. Create a GitHub release tagged `v<version>` and attach `glocon-<version>.tgz` with release notes.
5. Install the public release URL in fresh consumer projects with the supported package managers.

CI runs tests only. It does not publish to npm or create releases automatically.

Reference: [npm installation sources](https://docs.npmjs.com/cli/install/) and [Bun package installation](https://bun.com/docs/pm/cli/add).
