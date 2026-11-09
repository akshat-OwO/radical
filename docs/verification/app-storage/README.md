# App-storage native verification

Verified the revised implementation for PR #202 on 2026-11-09. These are emulator and simulator checks, not physical-device checks.

- Android: Pixel_9, Android 16, API 36, serial `emulator-5554`, app `dev.radical.example.android`.
- iOS: iPhone 17 Pro, iOS 26.5, simulator `F69D9CE5-20E1-4388-9EBA-27B1782EEF75`, app `dev.radical.example.ios`.

## Builds and generated projects

Selected the installed JDK 21 for Android:

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home \
  pnpm --filter @radical/example exec radical android --generate-only
JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home \
  apps/example/.radical/android/android/gradlew \
  -p apps/example/.radical/android/android assembleDebug
```

The final Android build passed with 489 tasks executed. [Build result](android/build.txt). Earlier compilation exposed unsupported `Files.readString` and `Files.writeString` calls. The final resolver uses API 24-compatible `android.system.Os`, `java.io`, and file locks, with no `java.nio.file` calls. The machine-default JDK 25 failure was a toolchain mismatch. Existing preflight already reports the Gradle compatibility link and recommends selecting a compatible JDK, including JDK 21. No toolchain fallback was added.

Parsed the merged AndroidManifest.xml with Python ElementTree. Both backup attributes belong to the application element: [extracted attributes](android/manifest.json). The generated resource XML includes `file/radical-storage/` for legacy backup, cloud backup, and device transfer.

Generated iOS and built with:

```sh
pnpm --filter @radical/example exec radical ios --generate-only
xcodebuild -project apps/example/.radical/ios/ios/App/App.xcodeproj \
  -scheme App -configuration Debug -sdk iphonesimulator \
  -destination id=F69D9CE5-20E1-4388-9EBA-27B1782EEF75 \
  -derivedDataPath apps/example/.radical/ios/build build
```

The final build passed. [Build result](ios/build.txt). The installed bundle contains PrivacyInfo.xcprivacy with file-metadata reason C617.1: [plist output](ios/privacy.txt). Direct backup-exclusion attributes are present on excluded and cache roots, and absent on the common parent and eligible root: [attribute inspection](ios/backup-flags.txt). Host Foundation reports inherited exclusion from the simulator's host directory, so this evidence inspects the direct extended attributes instead.

New in-memory Effect tests exercise full Android and iOS generation. They check the generated application element, both backup resource files, the privacy manifest file, Xcode resource references, and native plugin source inclusion. The Effect harness does not execute Java or Swift. Standalone native tests below compile the production confinement helpers, and device probes exercise the complete resolvers.

## Native checks

Installed each generated app and drove every launch and relaunch with the pinned command returned by T3 `device_open`. A disposable loopback server on port 4173 served [probe.html](probe.html) as `index.html`, with `stage.json` selecting each stage. Android used a task-owned `adb reverse tcp:4173 tcp:4173`. The page calls the native bridge directly, records expected and actual results, and sets `pass` for each assertion. The example's manual splash is dismissed through its bridge commands.

All 24 assertions passed on each platform:

| Stage | Assertion count | Android | iOS |
| --- | --: | --- | --- |
| create | 5 | [pass](android/create.txt) | [pass](ios/create.txt) |
| reopen | 2 | [pass](android/reopen.txt) | [pass](ios/reopen.txt) |
| symlink | 7 | [pass](android/symlink.txt) | [pass](ios/symlink.txt) |
| restore | 5 | [pass](android/restore.txt) | [pass](ios/restore.txt) |
| interrupted | 3 | [pass](android/interrupted.txt) | [pass](ios/interrupted.txt) |
| eviction | 2 | [pass](android/eviction.txt) | [pass](ios/eviction.txt) |

Create opened eligible, excluded, and cache stores. Android created roots under internal files, `no_backup`, and cache, including eligible policy directories: [native directories](android/roots.txt). Reopen ran after terminating and relaunching the app. The first operation in the new process requested a different policy and returned StorePolicyConflict; the original policy still opened.

Symlink fixtures included a link to an existing outside directory, a link to a missing outside destination, a link inside the store, and an escaped policy-directory link. Both dangling-leaf and dangling-parent requests returned InvalidStorageInput. Traversal was also rejected; an ordinary path succeeded. The outside sentinel stayed unchanged. Android fixtures were created through `adb shell run-as`; iOS fixtures were created in the simulator's app container on the host. Neither method drove UI.

Restore simulated the on-disk result of backup restoration: retain eligible data and its eligible metadata, remove excluded and cache roots, and relaunch. Reopening eligible data as excluded or cache returned StorePolicyConflict. A second identity also had its eligible metadata removed, simulating legacy or data-only restoration. Its existing eligible directory still prevented a conflicting reopen; reopening as eligible repaired its metadata. This does not exercise a platform cloud-backup service.

Interrupted simulated a kill after store-directory creation but before policy publication. The fixture contained an eligible store directory with no final policy and an abandoned partial temporary record. A conflicting class was rejected. Opening the original class succeeded and published a complete policy; another conflicting reopen was rejected. This checks recovery from the interrupted state, not power-loss durability or an instrumented kill during fsync. Android publishes a flushed nonempty policy directory by rename because SELinux denied hard-link creation with EACCES. Existing nonempty policy directories cannot be replaced by that rename. iOS publishes by exclusive hard link. Both serialize publication and store creation with advisory locks.

## Deterministic confinement regressions

The native tests compile the exact helper sources shipped in the generated apps. They run separately from vp run ready because they require a host JDK and the macOS Swift toolchain. [Results](confinement.txt).

Android's public API 24 filesystem API cannot perform descriptor-relative mkdirat/openat. RadicalStorageOwner therefore serializes all Radical app-storage mutations, across all capabilities and all three roots, in the shell process. Every filesystem helper requires this owner. The validation/use interval is one synchronous critical section. No Radical storage API creates symlinks. Arbitrary native code or another process that mutates these private roots without routing through the owner is outside this contract. Namespaces are not authorization boundaries against bridged JavaScript. See the [storage threat model](../../storage/foundation.md#confinement-and-native-mutation-ownership).

StorageOwnerTest uses an in-memory parent-path model. After validation, a second thread attempts to replace the parent through the production owner. The test uses JVM monitor state and lock ownership to verify that this competing task is blocked by the validating thread, then checks the event sequence is validate, use, swap and the modeled outside directory received no creation. It uses no sleeps, timeouts, network, or real filesystem operations.

StorageBackupTest opens a real directory with no-follow flags, renames its parent, and substitutes a symlink pointing at an outside directory before applying the attribute. It then calls the production RadicalStorageBackup helper to set and clear the exclusion marker. Both operations change only the verified inode; the outside target's direct attribute stays unchanged. The test also checks the typed failure for an invalid descriptor. There are no timing windows or test hooks: the parent replacement is completed before the attribute access.

Run from the repository root:

```sh
storage_test_dir="$(mktemp -d)"
/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home/bin/javac \
  -d "$storage_test_dir" \
  packages/radical/templates/android/RadicalStorageOwner.java \
  packages/radical/tests/native-behavior/StorageOwnerTest.java
/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home/bin/java \
  -cp "$storage_test_dir" StorageOwnerTest
swiftc packages/radical/templates/ios/RadicalStorageBackup.swift \
  packages/radical/tests/native-behavior/StorageBackupTest.swift \
  -o "$storage_test_dir/backup-test"
"$storage_test_dir/backup-test"
python3 -c 'import shutil, sys; shutil.rmtree(sys.argv[1])' "$storage_test_dir"
```

Cache eviction was also checked after relaunch. Only cache data was removed; its excluded policy record remained. Before the first request, the identity had no data directory in any class and its policy still read cache: [Android state](android/eviction-before.json), [iOS state](ios/eviction-before.json). Requesting eligible returned StorePolicyConflict through the policy-record lookup; reopening cache then succeeded. This cannot pass merely through directory reconciliation.

## Additional Android lint

Ran `./gradlew :app:lintDebug` with JDK 21. It reported no app-storage findings and no NewApi errors. The full task fails on an existing issue outside this change:

```text
RadicalTrackingService.java:293: Error: Call requires permission which may be rejected by user:
code should explicitly check to see if permission is available (with checkPermission)
or explicitly handle a potential SecurityException [MissingPermission]
```

The Android 16 emulator cannot prove API 24 execution. SDK lint and the API-compatible implementation cover that static compatibility check.

## Cleanup

Both installed example apps, generated native projects and builds, temporary server files, verification scripts, and task-owned port forwarding are removed after verification. Gradle daemons started for these checks are stopped with `./gradlew --stop`. Both device sessions are closed and both devices are shut down. Evidence and the reusable probe remain in this directory.
