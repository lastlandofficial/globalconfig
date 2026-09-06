# Distribution and publishing

## Public distribution without an npm account

The GitHub release contains the output of `npm pack`: compiled ESM/CommonJS, declarations, documentation, and license. npm, pnpm, Yarn, and Bun can install that public `.tgz` URL. No registry account, custom registry, package-manager plugin, or consumer build script is required.

Keep release URLs versioned and immutable. Do not replace `v0.1.0` assets with different code. A later change gets a new package version and release tag. The source repository intentionally does not track `dist`, so install a release asset rather than the Git repository directly.

## Publish to the npm registry later

The package name is `globalconfig`. It was not present in the npm registry when checked on 2026-09-06; availability is not a reservation. npm publication requires an account with permission to publish that name, and may require 2FA. Bun, pnpm, and Yarn use the same published npm package.

From a clean checkout:

```sh
npm ci
npm run check
npm login
npm publish --access public
```

The `prepublishOnly` hook runs the checks again, and `prepack` rebuilds the package. Perform login locally; never put an npm token in source files or share it in an issue. After publication, verify:

```sh
npm view globalconfig version
npm install globalconfig
pnpm add globalconfig
yarn add globalconfig
bun add globalconfig
```

Only the GitHub distribution is live until this publication step succeeds. Consumers installing by the short package name before that will receive a registry error.

## Create a later GitHub release

1. Update the version, lockfile, changelog, and versioned installation links.
2. Run `npm ci`, `npm run check`, and `npm pack`.
3. Commit the reviewed source and push it to the public repository.
4. Create a GitHub release tagged `v<version>` and attach `globalconfig-<version>.tgz` with release notes.
5. Install the public release URL in fresh consumer projects with the supported package managers.

CI runs tests only. It does not publish to npm or create releases automatically.

Reference: [npm installation sources](https://docs.npmjs.com/cli/install/) and [Bun package installation](https://bun.com/docs/pm/cli/add).
