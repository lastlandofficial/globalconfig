# Distribution and publishing

This checkout is a 0.7.0 release candidate. As verified on 2026-10-08, npm latest is 0.5.0 and GitHub has the financial 0.6.0 tarball. Do not describe 0.7.0 as publicly available until `npm run check:distribution` passes.

## Public distribution without an npm account

The GitHub release contains the output of `npm pack`: compiled ESM/CommonJS, declarations, documentation, and license. npm, pnpm, Yarn, and Bun can install that public `.tgz` URL. No registry account, custom registry, package-manager plugin, or consumer build script is required.

The original GitHub v0.1.0 tarball uses the unscoped name `globalconfig`; its imports remain unscoped. The scoped npm release `@lastlandofficial/globalconfig@0.1.0` was unpublished. The earlier `globalconfigurations@0.1.0` release was also unpublished. The current package name is `glocon`.

Keep release URLs versioned and immutable. Do not replace `v0.1.0` assets with different code. A later change gets a new package version and release tag. The source repository intentionally does not track `dist`, so install a release asset rather than the Git repository directly.

## Publish through the reviewed CI workflow

The repository prepares `.github/workflows/publish.yml` for an explicit workflow dispatch. It calls the full CI workflow, then runs the publishing job in the protected `npm-release` environment with npm provenance. The publishing job re-verifies the candidate and publishes the exact tested archive with lifecycle scripts disabled; it then verifies public distribution against that candidate. Preparing this workflow does not configure either account or publish a package.

An npm package owner must configure its trusted publisher for GitHub owner `lastlandofficial`, repository `globalconfig`, workflow `publish.yml` and environment `npm-release`. Follow the [official npm trusted-publisher instructions](https://docs.npmjs.com/trusted-publishers/) and explicitly allow direct publication when configuring the publisher; a staging-only configuration does not authorize this workflow's direct publish step. Configure the matching GitHub environment protection rules before dispatching. npm also requires a newly configured trusted publisher's first successful publication within its documented activation window; check the current account guidance when enabling it.

Dispatch against the reviewed source and intended package version only after the account configuration is complete. CI failures stop publication. The public install/integrity check remains the release-delivery gate after publishing; neither the workflow file nor an earlier local manifest is proof of a delivered release.

## Publish locally to the npm registry

The project is named **globalconfig** and its npm package name is `glocon`. npm publication requires an account with permission to publish that name and two-factor authentication for interactive publishing. Bun, pnpm, and Yarn use the same published npm package. For subsequent releases, increase the package version before publishing.

Before publishing, review the exact source commit and confirm the current full CI workflow passes, including packaged Electron and Android/Hermes. The release candidate manifest records archive sha512 integrity, source-tree hash and completed validation for a particular candidate. Earlier counts and CI links are historical evidence; they do not validate later source or documentation edits. Rebuild and refresh that manifest whenever source or packaged documentation changes. Validate the documentation, schemas and onboarding examples as part of the current release checks.

From a clean checkout:

```sh
npm ci
npm run release:verify
npm login
npm publish ./glocon-0.7.0.tgz --ignore-scripts --access public
npm run check:distribution -- --verified-candidate
```

`npm run release:verify` runs current core/browser/packed-consumer, documentation/schema, framework, minimum-runtime, dependency-audit and formatting checks. It writes actual task statuses, log digests, source-tree hash, git state and tested archive integrity to `glocon-0.7.0.release.json`; detailed logs stay in the gitignored `.glocon/release/` directory. `npm run release:verify -- --extended` additionally verifies browser/package-manager matrices and packaged Linux Electron. Android, other operating systems, publication and real independent trials require their own current evidence. A failed task is recorded as failed, and source changes during verification invalidate the run.

Publish the exact archive whose integrity the completed verifier recorded. `--ignore-scripts` avoids rebuilding a different artifact during archive publication. Publishing the project directory instead invokes `prepublishOnly` checks and a `prepack` rebuild; regenerate and recheck release evidence if you choose that path. Perform login locally; never put an npm token in source files or share it in an issue. After publication, verify:

```sh
npm view glocon version
npm install glocon
pnpm add glocon
yarn add glocon
bun add glocon
```

## Create a later GitHub release

1. Update the version, lockfile, changelog, and versioned installation links.
2. Run `npm ci` and `npm run release:verify -- --extended`, then inspect the manifest and archive integrity.
3. Commit the reviewed source and push it to the public repository.
4. Create a GitHub release tagged `glocon-v<version>` and attach `glocon-<version>.tgz` with release notes.
5. Install the public release URL in fresh consumer projects with the supported package managers.

CI runs engineering checks and verifies public installation after a GitHub release or manual distribution dispatch. Publishing requires a separately authorized npm account or configured trusted publisher; passing engineering checks alone does not publish or create a release. The distribution gate checks the current version is the latest registry tag, validates the public tarball sha512 digest, installs the default `glocon` spec in a fresh directory, and exercises financial exports and the CLI. Publishing credentials remain an external release requirement.

Reference: [npm installation sources](https://docs.npmjs.com/cli/install/) and [Bun package installation](https://bun.com/docs/pm/cli/add).

## Independent application readiness

Release verification records engineering checks for an exact source/archive pair. Complete the [separate UI and financial application trials](readiness-trials.md) before claiming independent usability or business acceptance. Keep their outcomes and unresolved scope requirements separate from automated fixture timings.
