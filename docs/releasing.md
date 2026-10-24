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

   Check the packed license before publishing:

   ```sh
   tar -xOf .release/akshatowo-radical-0.1.0.tgz package/LICENSE
   ```

   The output contains the MIT license and `Copyright (c) 2026 Akshat`.

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
   gh release create v0.1.0 --target "$(git rev-parse HEAD)" --title v0.1.0 --notes "The attached tarball is the published npm package. This tag records source with a placeholder version; stamp 0.1.0 before rebuilding." --generate-notes .release/akshatowo-radical-0.1.0.tgz
   ```

The tag identifies the source commit, whose manifest retains `0.0.0`. To reproduce the published version from that tag, stamp `0.1.0` before building and packing. The attached tarball contains the stamped manifest and CLI.

Do not commit the stamped version. npm versions are immutable. If manual publication succeeds but creating the GitHub release fails, rerun step 5.

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

For production releases, merge `main` into the long-lived `stable` branch. Run `.github/workflows/release.yml` with **Run workflow**, select `stable`, enter the version, and clear **dry_run**. The workflow creates the release tag after publishing.

Use `0.1.1` for a stable release, or `0.2.0-alpha.1` for the `alpha` npm dist-tag. The workflow also accepts pushed `v*` tags. Stable releases use `latest`. Prereleases cannot use the reserved `latest` channel. Build metadata and numeric-only prerelease channels are rejected. Manual dispatch accepts the same version and defaults to a dry run.

The pipeline runs `vp run ready`, stamps and builds the package, and verifies a clean install of the tarball. It publishes and attaches that same tarball to the GitHub release. Dry runs publish nothing.

If the automated `publish` job succeeds but `github-release` fails, select **Re-run failed jobs** on that workflow run. GitHub reruns `github-release` with the same verified tarball and the original tag and commit. The successful `publish` job does not rerun, so recovery never calls `npm publish` again. If the GitHub release already exists, the job succeeds without recreating it.

Do not select **Re-run all jobs** or dispatch a new run to recover a failed `github-release` job. Preflight still rejects versions that already exist on npm.

## Deploy production docs after a release

Configure the docs Vercel project before the first release from `stable`:

1. Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` to the GitHub `release` environment secrets. Use the docs project's ID.
2. In Vercel, set **Settings → Environments → Production → Branch Tracking** to `stable`. Keep the project's root directory at `apps/docs`.
3. Merge `main` into `stable` after the deployment workflow and `apps/docs/vercel.json` changes land.

The `docs` job shares the `release` environment's approval policy. It runs only after `github-release` succeeds and checks out the exact preflight SHA. If that SHA is not an ancestor of `origin/stable`, the job skips deployment with a notice. This keeps main-branch prereleases outside `stable` from deploying production docs. Dry runs do not deploy.

`apps/docs/vercel.json` disables Git deployments for `stable`. Merges to `stable` do not deploy docs. After changing Vercel's production branch, `main` and pull requests keep their preview deployments.

The job installs Vercel CLI `65.2.0` and runs `vercel pull`, `vercel build --prod`, and `vercel deploy --prebuilt --prod` from the repository root. The single-project link lives at `.vercel/project.json` in the repository root. With the pulled root-directory setting of `apps/docs`, the build writes to `apps/docs/.vercel/output`, and the prebuilt deployment reads that same directory. See [Vercel build](https://vercel.com/docs/cli/build) and [prebuilt deployments](https://vercel.com/docs/cli/deploy#prebuilt).

Deployment stays in `release.yml` because tags created with `GITHUB_TOKEN` do not trigger another tag-push workflow. If only `docs` fails, use **Re-run failed jobs** to retry deployment without republishing npm.
