# Publish Radical

Publish `@akshatowo/radical` from this repository. The first release is `0.1.0`. The package manifest on `main` keeps `0.0.0`. Release builds stamp the selected version into the manifest, and the CLI reads that version at build time.

## Publish the first version manually

Use Node.js 24 and the repository's pnpm version. Sign in to the npm account that owns the `@akshatowo` scope. Run npm commands outside the repository because the root `devEngines` requires pnpm.

1. Check out the merged release preparation on `main` and run the release gate:

   ```sh
   pnpm install --frozen-lockfile
   vp run ready
   ```

2. Stamp, build, and pack the first version from the repository root:

   ```sh
   node packages/radical/scripts/release.ts stamp 0.1.0
   pnpm --filter @akshatowo/radical build
   mkdir -p .release
   pnpm --filter @akshatowo/radical pack --pack-destination "$PWD/.release"
   node packages/radical/scripts/release.ts stamp 0.0.0
   ```

   The tarball is `.release/akshatowo-radical-0.1.0.tgz`. Keep this file for verification, publication, and the GitHub release.

3. Install that tarball into a temporary consumer and check the CLI:

   ```sh
   radical_release_root="$PWD"
   radical_consumer="$(mktemp -d)"
   cd "$radical_consumer"
   npm install --no-audit --no-fund "$radical_release_root/.release/akshatowo-radical-0.1.0.tgz"
   ./node_modules/.bin/radical --version
   ./node_modules/.bin/radical --help
   ```

   The version command prints `radical v0.1.0`. The help lists `android`, `ios`, and `typegen`.

4. From the temporary directory, sign in and publish the verified tarball:

   ```sh
   npm login
   npm whoami
   npm publish "$radical_release_root/.release/akshatowo-radical-0.1.0.tgz" --access public --tag latest --ignore-scripts
   npm view @akshatowo/radical@0.1.0 version
   ```

5. Return to the repository and create the GitHub release at the checked-out commit:

   ```sh
   cd "$radical_release_root"
   gh release create v0.1.0 --target "$(git rev-parse HEAD)" --title v0.1.0 --generate-notes .release/akshatowo-radical-0.1.0.tgz
   ```

Do not commit the stamped version. npm versions are immutable. If publication succeeds but creating the GitHub release fails, retry the GitHub step only.

## Enable automated releases after the first publish

The release pipeline is prepared in a separate PR. Merge it after the manual release, then configure the package's npm trusted publisher:

| Setting              | Value          |
| -------------------- | -------------- |
| Publisher            | GitHub Actions |
| Organization or user | `akshat-OwO`   |
| Repository           | `radical`      |
| Workflow filename    | `release.yml`  |
| Environment          | `release`      |

Allow direct `npm publish` for that publisher. Create the GitHub `release` environment and configure any desired reviewers before running a release. The pipeline uses OIDC credentials. It does not need an `NPM_TOKEN`. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Push `v0.1.1` for a stable release, or `v0.2.0-alpha.1` for the `alpha` npm dist-tag. Stable releases use `latest`. Prereleases cannot use the reserved `latest` channel. Build metadata and numeric-only prerelease channels are rejected. Manual dispatch accepts the same version and defaults to a dry run.

The pipeline runs `vp run ready`, stamps and builds the package, and verifies a clean install of the tarball. It publishes and attaches that same tarball to the GitHub release. Dry runs publish nothing.
