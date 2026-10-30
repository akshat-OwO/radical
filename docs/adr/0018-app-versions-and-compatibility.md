# 0018: App versions and compatibility

Status: accepted

Generated shells keep Capacitor's version defaults, `versionCode 1` and `versionName "1.0"` on Android and `MARKETING_VERSION 1.0` and `CURRENT_PROJECT_VERSION 1` on iOS. `replaceProject` regenerates the whole native project on every run, so a hand-edited build number is lost. The stores reject an upload that reuses a build number. Native context carries `shellVersion`, which is Radical's own package version, so neither the page nor the server can tell which release of the app is installed.

Many releases of one app are installed at once. Radical does not serve a different UI to each release. Each release reports its app version and app build, and the shell reports the commands it contains. The app adapts to them, and a server-side minimum build turns away releases it no longer supports.

## What each mode serves

In remote mode every installed shell loads the one current deployment. A web change reaches every release on its next load. The manifest build id identifies a web deployment, not a native release, and offline snapshots stay keyed by it. The UI must cope with shells that lack newer commands.

In bundled mode each release keeps the UI packaged in its binary, and every release calls the one current origin. The server must accept requests from every bundled release at or above the minimum build. TanStack Start identifies a server function by a hash of its file and function name, so a moved file, a renamed function, a new required input, or a removed response field breaks older binaries. Change server functions and APIs additively. Delete one only after the minimum build for that platform has moved past every release that calls it.

## App version and app build

The config gains `version`, the marketing version shown in the stores, and `build`, a positive integer that increases with every upload. `version` defaults to the app's `package.json` version. `build` comes only from config, a `--build` CLI flag, or an environment variable, in that order of precedence, and is never incremented at generation time. CI owns the counter. One integer serves both platforms. Generation writes both values into Gradle and the Xcode build settings, validates platform limits, and prints the resolved values.

Shells read their version and build at runtime from the installed binary, through `PackageManager` on Android and `Bundle.main` on iOS. Values changed at archive time are then still reported correctly. Native context gains optional `appVersion` and `appBuild`, sent through the existing cookie in remote mode and the `x-radical-context` header in bundled mode.

`shellVersion` keeps its name and meaning. It is required, and a context that fails to decode becomes browser context with zero insets. Renaming it would put every installed shell into that state. Shells built before this change send no `appBuild`, which is treated as older than every minimum build.

These values are untrusted presentation data, like the rest of native context. They decide compatibility, never authorization.

## Shell commands

Before calling a command, a capability hook needs to know whether the installed shell contains it. Generation writes the shell's plugin and command list, filtered to the platform, into the binary. The shell injects it at document start, so hooks can read it before mount. When the list is missing, the shell predates it and contains only the commands that existed at that time. Hooks report a missing command as unavailable instead of calling it.

A command's presence does not prove that its options and results match the page's expectations. Commands evolve additively; an incompatible change is a new command.

## Minimum build and update screen

The server holds a minimum build for each platform, so an iOS-only release does not lock out Android. Radical's server middleware compares the request's app build with that minimum. Raise the minimum only after the new build is available in the store.

In remote mode the server renders the update screen in place of the requested route. It is an ordinary page of the web app, so it can be added or changed after a release ships, and it reaches shells built before this change. Offline navigations keep serving snapshots, because no server compatibility is at stake.

In bundled mode the middleware rejects requests below the minimum with `426 Upgrade Required` before the handler runs. `createRadicalFetch` recognizes that response and switches the app to the update screen. A bundled app can also fetch the policy at startup. Only binaries that contain this code can show the screen. A bundled release shipped without it sees failing requests and relies on the app's own error handling. The screen must therefore be in the first bundled binary uploaded to a store.

The web app draws the screen. `useAppUpdate()` reports `current`, `required`, or `unknown` with the store URL, and Radical ships a default screen that the app can replace. The store URL opens through the intents capability. Android uses the Play listing for the package id. iOS needs the numeric App Store id in config, because the bundle id cannot address a listing. An optional "update available" banner uses the same hook without blocking the app.

## Considered options

- **A separate UI per release.** Rejected. Routing deployments by build needs retained assets, CDN variation by build, and per-build service workers. One adaptive UI needs none of these.
- **Renaming `shellVersion` to `radicalVersion`.** Rejected because installed shells would fail to decode. An alias can be added later without breaking anything.
- **Deriving `build` from the marketing version or incrementing it at generation.** Rejected. Semver does not map to a monotonic integer, and local regeneration would consume store build numbers.
- **The command list in the cookie or header.** Rejected. It rides on every request and can exceed cookie size limits. Only the app version and build go to the server.
- **Probing a command to see whether it exists.** Rejected. A call to a missing method on an existing plugin may never settle, and `isPluginAvailable` cannot see new commands on existing plugins.
- **A native update screen.** Rejected for now. It survives a broken web UI but is hard to customise, and remote mode does not need it.
- **Over-the-air bundle updates.** Out of scope. They would let bundled releases receive new UI without a store release, which changes store policy and the compatibility rules above.

## Consequences

- The version fields, the context fields, and the update screen must ship before an app's first store upload. A release without them cannot be distinguished later or, in bundled mode, told to update.
- Server-function compatibility becomes the app author's responsibility for as long as bundled releases above the minimum are installed. Tests against an old bundle are the way to check it.
- Google Play In-App Updates and an iOS equivalent are not part of this decision.
