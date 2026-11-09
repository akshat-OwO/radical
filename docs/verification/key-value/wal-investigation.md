# WAL preservation blocker remains open

The strict requirement is not met. This investigation reproduces changes to the main database, WAL, or SHM after failed calls at PR head 6f600e1. No production workaround is included in this follow-up: neither a read-only preflight nor the suggested iOS close controls alone preserves every file.

The earlier corruption verification only checked the main database hash after closing clean connections. That evidence does not establish crash-left WAL/SHM preservation. This document supersedes those claims for database-file corruption.

## Reproduction

The expanded [instrumentation](instrument-corruption.py) hashes existence, length, and SHA-256 for the database, -wal, -shm, and -journal. Missing files are explicit records. Each operation gets its own identity and independently seeded database so a previous failed operation cannot hide the next operation's damage.

Fixture seeding creates a WAL database, commits a row, checkpoints with TRUNCATE, and optionally commits another update. The seed connections stay open. The app exits using Runtime.halt on Android or _exit on iOS, bypassing SQLite close. After relaunch, the fixture corrupts the schema b-tree type at offset 100 and records the initial file state. The probe then invokes get, set, or clear and records every file again.

The nonempty fixture leaves a 4,152-byte WAL and existing SHM. The empty fixture leaves a zero-byte WAL and existing SHM. An additional orphan-shm fixture removes the empty WAL during fixture setup, retaining SHM, to check whether opening creates a previously absent sidecar. That third case is an intentionally constructed edge case, separate from the genuine crash-left WAL cases.

All get/set/clear calls return StorageIOFailed. Returning the right error does not mean file preservation succeeded.

## Device observations

[Android results](android/wal.json), [seed metadata](android/wal-seeds.json), and [snapshot](android/wal.txt) came from Pixel_9, Android 16, platform SQLite 3.44.3. The instrumentation uses public APIs available at API 24, including OPEN_READONLY and NO_LOCALIZED_COLLATORS. This is not an API 24 runtime test.

| Android candidate | Nonempty WAL | Empty WAL | Orphan SHM |
| --- | --- | --- | --- |
| Current production path | Main, WAL, SHM change | WAL and SHM change | SHM changes |
| Read-only integrity preflight | SHM changes | SHM changes | WAL created and SHM changes |

Each cell describes all three separately seeded get/set/clear cases. The read-only connection is closed before any writable connection opens. Corruption is detected during that preflight, yet its SHM hash changes. Consequently this API-24-compatible preflight does not satisfy the requested all-file contract. The Android public SQLiteDatabase API exposes neither the native connection handle nor sqlite3_db_config/file_control. Private reflection, private native platform symbols, permission toggling, file restoration, and copying to a shadow database were not shipped as substitutes.

[iOS results](ios/wal.json), [seed metadata](ios/wal-seeds.json), and [snapshot](ios/wal.txt) came from iPhone 17 Pro, iOS 26.5, SQLite 3.51.0.

| iOS candidate | Nonempty WAL | Empty WAL | Orphan SHM |
| --- | --- | --- | --- |
| Current production path | Main, WAL, SHM change | SHM changes | WAL created and SHM changes |
| Read-only integrity preflight | SHM changes | SHM changes | All tracked files unchanged |
| Both close controls | SHM changes | SHM changes | WAL created and SHM changes |
| Both controls plus exclusive locking | All tracked files unchanged | All tracked files unchanged | WAL created |

The iOS build supports both SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE and SQLITE_FCNTL_PERSIST_WAL: return codes are SQLITE_OK and read-back settings are 1, recorded in the seed metadata. The controls are installed immediately after open and before statements in their candidate paths. Because Swift cannot directly call the variadic db_config function, the test app uses a fixed-arity [C shim](wal-config.c) and [header](wal-config.h). These are test-only generated-project additions.

The exclusive-lock candidate avoids the shared WAL index for the two crash-left WAL fixtures. This is a promising iOS-specific path, not a verified cross-platform fix. It does not resolve the Android API limitation, it creates a WAL in the additional missing-WAL edge case, and healthy-operation durability/performance have not been validated for shipping it.

## Why read-only and the close controls are insufficient

SQLite documents SHM as a volatile shared-memory cache, not database content. A client connecting after a crash may rebuild it; its bytes are not guaranteed to survive even a read-only probe. Read-only is therefore different from an immutable complete file set. See the [WAL-index lifecycle](https://www.sqlite.org/walformat.html#the_wal_index_or_shm_file) and [read-only WAL requirements](https://www.sqlite.org/wal.html#read_only_databases).

The two close controls suppress close-time checkpointing and deletion, respectively. Neither freezes SHM updates during opening or reading. [Database configuration](https://www.sqlite.org/c3ref/c_dbconfig_defensive.html) and [persistent WAL control](https://www.sqlite.org/c3ref/c_fcntl_begin_atomic_write.html).

A fix must distinguish durable database/WAL recovery from the volatile index while honoring the exact requested invariant. Alternatively it needs a supported native/VFS interface that can control these accesses before SQLite initializes them. This investigation has not established a supported implementation of that full invariant through android.database.sqlite on API 24.

## Durability and trade-offs

Production durability is unchanged because no candidate was promoted into production. Suppressing the final checkpoint without ensuring durable WAL commits could weaken a configuration that relies on that checkpoint for synchronization. A shipping change must preserve full commit durability and retain a bounded checkpoint strategy. A full integrity scan before every operation would also add work proportional to database size while still failing the SHM requirement shown here.

The exclusive-lock candidate changes connection behavior, and an Android replacement native/VFS layer would change the implementation boundary agreed in #179. Neither is treated as an approved design change or hidden behind a passing repository check.

## Host probe and verification commands

The [native host diagnostic](../../../packages/radical/tests/native-behavior/key-value-wal-probe.py) compiles [KeyValueWALProbe.c](../../../packages/radical/tests/native-behavior/KeyValueWALProbe.c) against Apple's SQLite and the same C shim. It creates each fixture in a child process that exits without close, then compares all four files. Like the device, all three operation variants fail during opening or the first PRAGMA, before their operation-specific SQL.

```sh
python3 packages/radical/tests/native-behavior/key-value-wal-probe.py
```

[Host results](host-wal.json) record SQLite 3.54.0. Only 9 of 36 candidate cases preserve every file; the diagnostic deliberately exits 1 when the requested invariant fails. This is a failing preservation probe, not a passing regression test. Host and simulator results differ on the extra orphan-SHM case, which is why the host probe cannot substitute for device verification.

Generate shells with the commands in the [original verification](README.md#builds), run instrument-corruption.py, and build with JDK 21 for Android and xcodebuild for the simulator. The script changes only generated sources and, for the C shim, the generated Xcode project. Production templates remain unchanged.

Serve [wal-probe.html](wal-probe.html) as index.html on the example's localhost:4173 origin. GET /stage/platform initially returns seed. POST /seed/platform saves the metadata and changes that platform's stage to check. The probe commits every seed, posts the metadata, then deliberately terminates the app. Relaunch with the pinned agent-device command; the check stage posts the final records to POST /results/platform. Use a fresh installation or store identity for every complete run.

Both instrumented device builds passed. The initial Swift feasibility compile reported `'sqlite3_db_config' is unavailable: Variadic function is unavailable`; the fixed-arity C shim compiled and its runtime support checks passed. No build error was suppressed.

Repository lint, formatting, and vp run ready are recorded separately in wal-checks.txt. A green repository check does not close this P1: the native preservation probes still fail.

## Cleanup

Both example apps were uninstalled; both device sessions were closed and devices shut down. Gradle daemons, the disposable server, and the Android port reverse were stopped. Generated projects, binaries, native fixtures, server files, and disposable logs were removed. Evidence and reusable probes remain. Pre-existing metadata and shared caches were retained.
