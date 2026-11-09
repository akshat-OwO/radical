# Database corruption and UTF-8 verification

Verified the PR #203 review fixes on 2026-11-09 using Pixel_9 on Android 16 and iPhone 17 Pro on iOS 26.5. The production Android open call now supplies an API 11 DatabaseErrorHandler that aborts on corruption without deleting or replacing files. The resolver maps its exception to a sanitized StorageIOFailed. This error identifies an inaccessible database; InvalidStoredValue remains reserved for invalid JSON or Schema decoding in a readable row.

The iOS path was checked for open, prepare, and execution failures. It closes handles and propagates StorageIOFailed without unlinking, replacing, or retrying the database. SQLITE_OPEN_CREATE only initializes absent stores. Neither platform attempts database repair.

## Device results

Both platforms passed all 27 checks:

- [Android results](android/corruption.json) and [accessibility snapshot](android/corruption.txt).
- [iOS results](ios/corruption.json) and [accessibility snapshot](ios/corruption.txt).

The probe creates and reads a valid database before damaging it. Header corruption overwrites the SQLite signature with non-SQLite bytes, exercising the NOTADB case. B-tree corruption changes the page-1 schema b-tree type at offset 100 to 255 while retaining the SQLite header, exercising the CORRUPT case.

For each fixture, the probe records the entire damaged file's SHA-256 and length. Each subsequent public get, set, and clear fails with StorageIOFailed containing only its tag. After every failure, test-only filesystem inspection returns the same digest and length. All six operations on each platform preserve the damaged bytes. These are real platform SQLite calls through the production bridge, resolver, and mutation owner.

The row-level fixture is separate. Reading the invalid JSON text returns InvalidStoredValue and leaves the text unchanged. An explicit set replaces that row successfully. A second invalid row is explicitly removed, and the next lookup returns found false. Reads never repair rows automatically.

The NUL checks set, get, and remove a key containing U+0000 and a supplementary UTF-8 character. Its JSON string value contains U+0000 and a multibyte character. The full key/value round-trips, a lookup using the prefix before NUL finds nothing, and removing the full key succeeds. Namespace identities reject NUL through the foundation's existing ASCII validation. Android and TypeScript required no behavior change.

iOS now binds from an explicit UTF-8 buffer using its byte count and SQLITE_TRANSIENT. Empty strings use a non-null pointer with count zero, preserving text rather than SQL NULL. Reads request sqlite3_column_text and use sqlite3_column_bytes for the same representation. No NUL-terminated string conversion reads stored text.

## Native host regression

The standalone test compiles the exact production SQLite text helper and runs platform SQLite in memory, without Capacitor mocks. It covers nine assertions, including raw embedded NUL text, UTF-8 byte counts, distinct key prefixes, JSON decoding, empty text, and deletion.

Run from the repository root, placing the disposable binary beneath an ignored directory:

```sh
mkdir -p apps/example/.radical/kv-review
swiftc packages/radical/templates/ios/RadicalKeyValueSQLite.swift \
  packages/radical/tests/native-behavior/KeyValueSQLiteTest.swift \
  -o apps/example/.radical/kv-review/sqlite-test
apps/example/.radical/kv-review/sqlite-test
```

[All nine checks passed](ios/sqlite-text-host.json). The Effect suite adds regressions for explicit row recovery, sanitized failures for get/set/clear, NUL key/value transport, and rejection of NUL namespaces. Generation tests assert Android's non-destructive handler is supplied and iOS includes the production text helper. These source-generation checks do not execute platform SQLite; the native host and device probes do.

## Reproduction and builds

These fixtures were applied with the 6f600e1 version of instrument-corruption.py. That script now drives the [WAL contract regression](wal-investigation.md#device-verification), so check out 6f600e1 to reproduce this review pass.

Generate both example shells using the [original build commands](README.md#builds), with JDK 21 for Android. Apply the test fixtures before building:

```sh
python3 docs/verification/key-value/instrument-corruption.py
```

The script saves generated production files and adds fixture branches only inside the resolved shared mutation owner. These branches alter database bytes, inspect file hashes, or seed invalid row JSON. All ordinary operations use production code. The production Android corruption handler and iOS text helper are unchanged by instrumentation. No diagnostic command ships in the package.

Bundle [corruption-probe.html](corruption-probe.html) with Vite using the same Effect aliases described in the original verification. Serve it at http://localhost:4173/ in the example shell. A disposable server accepts POST /results/android and POST /results/ios and saves the displayed result records. Android uses a task-owned adb reverse. Run on a fresh installation or a fresh store identity because the probe intentionally leaves its database fixtures corrupt. Record every launch and snapshot with the pinned agent-device command returned by device_open.

The final iOS incremental build copied the production helper and binding changes into the already generated, instrumented shell. Generation tests separately verify that the manifest includes that helper for fresh shells.

Final Android and iOS builds passed. [Build summaries](review-builds.txt). The first Android test-fixture build failed due to incorrectly escaped quotes in generated fixture code:

```text
RadicalKeyValuePlugin.java:97: error: '}' expected
```

The fixture now uses JSONObject.quote; rebuilding passed. The production template was unaffected. Initial iOS digest comparisons also exposed unordered JSON object properties in bridge results. The probe now compares records with sorted keys; matching digests and lengths no longer depend on property order. The complete probe was rerun on both platforms.

## Cleanup

Both verification apps were uninstalled, device sessions closed, and devices shut down. Gradle daemons, the loopback server, and the task-owned port reverse were stopped. Generated native projects, builds, saved source copies, the native host binary, bundled probe, and disposable files were removed. Pre-existing metadata and shared caches were retained. No task-owned process or device session remains.
