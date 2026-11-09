# Native key-value verification

**Failure preservation:** the [WAL contract record](wal-investigation.md) defines what failed operations may change: never the main database or WAL, only SHM or a newly created empty WAL. It also describes the shipped preflight and quarantine design and the passing native host regression. On-device runs of that design are still pending, so the P1 stays open until they pass. The record supersedes the earlier main-file-only corruption claims below.

The latest review pass verifies corrupt database preservation, explicit row recovery, and embedded NUL text on both platforms. See [review verification](review-corruption.md) for the additional device and native-host results. The original capability verification follows.

Verified on 2026-11-09 for #181 using the Pixel_9 Android 16 emulator and iPhone 17 Pro iOS 26.5 simulator. These checks do not claim physical-device or API 24 execution.

The probe imports the public Effect client and supplies BridgeLive. All launches, relaunches, and accessibility snapshots used the commands returned by T3 device_open. Both device_screenshot calls also showed the running probe. adb and simctl were used for installation; adb supplied one task-owned port reverse.

## Results

| Stage | Android | iOS |
| --- | --- | --- |
| Create | [24 passing checks](android/create.json) | [27 passing checks](ios/create.json) |
| Process relaunch | [16 passing checks](android/reopen.json) | [19 passing checks](ios/reopen.json) |

The corresponding accessibility snapshots are [Android create](android/create.txt), [Android relaunch](android/reopen.txt), [iOS create](ios/create.txt), and [iOS relaunch](ios/reopen.txt).

Create checks JSON round-trips, missing versus null, namespace isolation, namespace clear, remove, corrupt JSON, byte limits, backup roots, and conflicting policies. The exact 1,048,576-byte JSON limit succeeds. Larger values fail both through the public API and through a direct native command.

A disposable native fixture writes the literal text `{broken` into the corrupt key. The public get reports InvalidStoredValue; a direct native read returns the same text. The same assertions pass after process relaunch. Persistence checks also recover the original object after relaunch.

For each backup class, instrumentation inspects the database while its connection remains open, when the WAL and SHM files exist. All three files are in the same foundation-resolved directory. Android verifies that directory against filesDir, noBackupFilesDir, or cacheDir. iOS verifies Application Support eligible/excluded or Caches and reads each file's Foundation isExcludedFromBackup resource value. Eligible files read false; excluded and cache files read true. Missing Foundation values fail the probe. Rollback journals were absent during these WAL operations; production applies the same sidecar checks and backup helper to -journal if present.

## Builds

The unmodified generated Android and iOS shells built successfully. Instrumented builds also passed after the typed rejection fix. [Build summary](builds.txt).

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home \
  pnpm --filter @radical/example exec radical android --generate-only
JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home \
  apps/example/.radical/android/android/gradlew \
  -p apps/example/.radical/android/android assembleDebug

pnpm --filter @radical/example exec radical ios --generate-only
xcodebuild -project apps/example/.radical/ios/ios/App/App.xcodeproj \
  -scheme App -configuration Debug -sdk iphonesimulator \
  -destination id=F69D9CE5-20E1-4388-9EBA-27B1782EEF75 \
  -derivedDataPath apps/example/.radical/ios/build build
```

The first Android generation command omitted JAVA_HOME and failed before generation with:

```text
AndroidToolchainError: Android toolchain preflight failed before generation.
```

Rerunning with the required JDK 21 passed. One premature assemble invocation before generation finished returned `zsh:1: no such file or directory: apps/example/.radical/android/android/gradlew`; running after generation passed.

Additional Android `:app:lintDebug` found no key-value, app-storage, or NewApi findings. It fails on the pre-existing tracking permission issue also recorded by #202:

```text
RadicalTrackingService.java:293: Error: Call requires permission which may be rejected by user: code should explicitly check to see if permission is available (with checkPermission) or explicitly handle a potential SecurityException [MissingPermission]
Execution failed for task ':app:lintDebug'.
> Lint found errors in the project; aborting build.
```

## Probe setup and limitations

[probe.html](probe.html) is bundled with Vite so it runs the production TypeScript client and Effect dependency. During this pass, a disposable Vite config selected this directory as root, aliased effect and its subpaths to packages/radical/node_modules/effect/dist, targeted esnext, and wrote output beneath the ignored example .radical directory. The probe was temporarily copied to index.html for bundling, then that copy was deleted.

[Instrument the generated sources](instrument.py) after generation and before rebuilding the verification apps:

```sh
python3 docs/verification/key-value/instrument.py
```

The script saves production source beside each generated file and changes only generated code. It injects corrupt text after opening SQLite under the shared owner, and adds root/file metadata to the native result. No test fixture or diagnostic command ships in the package. The native plugin, SQL, resolver, serialized owner, and backup helper otherwise remain the production implementation.

A disposable server on 127.0.0.1:4173 served the bundled probe. GET /stage.json selected create or reopen; POST /results/platform/stage saved the displayed JSON. Android used adb reverse tcp:4173 tcp:4173. Both app processes were relaunched after changing stage to reopen. Requests use synthetic public fixtures only. No stored user values, secrets, or container paths appear in the evidence.

The first device pass exposed StorePolicyConflict arriving as BridgeCallFailed because Capacitor supplies an explicitly undefined data property for a rejection without native data. The shared plugin decoder deliberately rejects that envelope. Storage-native rejections now explicitly send an empty object. Both platforms then returned StorePolicyConflict, without changing the decoder or weakening malformed-envelope validation. Generation regressions assert the emitted rejection objects.

The Effect tests also cover Schema failures without overwriting values, browser Unavailable, missing native commands, bridge-error redaction, non-JSON inputs, hook actions and identity replacement, and enabled/disabled source generation. These deterministic tests use in-memory bridge layers and Deferred signals, with no network or real timers.

## Cleanup

Both example apps were uninstalled. Task-owned device sessions were closed with device_close and both devices were shut down. Gradle daemons were stopped with gradlew --stop. The loopback server, adb reverse, generated native projects and builds, bundled probe output, and disposable logs were removed. The pre-existing .radical/native.json and plugins.d.ts remain as generated metadata. No task-owned server, watcher, device session, or port forward remains.
