# Data protection verification

Verified on 2026-10-22.

## Automated checks

These commands pass from the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm exec ultracite fix
pnpm exec ultracite check
vp run radical#build
vp run @radical/example#build
vp run ready
```

The ready task passes all 305 tests across 42 files, including the Effect type check. `pnpm-lock.yaml` contains no `@pnpm/exe` entries. The example build regenerates `src/routeTree.gen.ts` with `/data-protection`.

`data-protection.test.ts` checks both native bridge commands, browser capability reporting, typed failures, Schema validation, origin cache and storage clearing, cookie path and domain expiry, IndexedDB completion, errors and blocked deletion, worker acknowledgements, timeout with TestClock, and opt-in native source manifests. `react-ssr.test.ts` proves actions do not read the bridge during SSR. The offline tests prove clearing waits for in-flight writes, prevents later snapshots, and cannot reopen caches when a pending navigation fails after clearing. Each test owns its memory state; no test uses a network or device.

## Native compilation

The review regression configuration, `internalPlugins: { dataProtection: true, transitions: false }`, passes Android `assembleDebug` and the iOS simulator build below. Both shell-generation tests also cover this configuration with in-memory layers, checking that data protection is registered and its source has no reference to the omitted transitions class.

The example configuration is restored after the regression builds. Transitions defaults to enabled. Overlay cleanup looks up the registered plugin through the bridge and invokes `clearData` at runtime; iOS exposes that method to Objective-C. Android's Capacitor consumer rules keep plugin members available to reflection.

Generate shells after building radical:

```sh
pnpm --filter @radical/example exec radical android --generate-only
pnpm --filter @radical/example exec radical ios --generate-only
```

From `apps/example/.radical/android/android`, this command reports `BUILD SUCCESSFUL`:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew assembleDebug
```

The generated Gradle project is inside the extra `android` directory. From the workspace root, this command reports `BUILD SUCCEEDED`:

```sh
xcodebuild -project apps/example/.radical/ios/ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination id=88BEE7A3-757E-40C4-A789-5E3259B6B673 -derivedDataPath apps/example/.radical/ios/build build
```

## Remaining device checks

The Device panel listed Pixel_9 as available and opened it visibly. Installation succeeded, but opening the app returned `DEVICE_IN_USE`, owned by another agent-device session. No session was taken over, and no second emulator was opened. FLAG_SECURE behavior, iOS capture and app-switcher obscuring, and native storage inspection remain unverified on a running device.

The production browser page was built and navigation succeeded. T3 preview snapshots timed out twice with `Preview automation snapshot timed out after 15000ms.` The alternate browser connector had no browser available. A browser screenshot and an interactive production-storage check could not be completed. Browser deletion is covered by the in-memory tests above.

On an available device, visit `/data-protection`, enable protection, and check capture and app-switcher behavior. Disable it and confirm ordinary capture returns. Visit an offline route online, return to the demo and clear data, then inspect WebView storage and relaunch offline. No old snapshot or saved offline URL should load. Close other tabs and database connections before clearing. Respect the [documented platform limits](../../packages/radical/README.md#data-protection).
