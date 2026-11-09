# WAL failure-preservation contract

This record states how native key-value storage treats SQLite files when an operation fails, why the shared-memory index is excluded, and the evidence for the shipped design. It supersedes the earlier candidate investigation recorded at f06ef71.

**Status:** the native host regression passes. On-device runs of the shipped design on Pixel_9 and iPhone 17 Pro are still pending; see [Device verification](#device-verification).

## Contract

On any failure, Radical never deletes, truncates, reinitializes, or checkpoints into the main database or its WAL. The existence, length, and SHA-256 of both files stay unchanged.

Two changes are allowed because neither holds data:

- The `-shm` file may change.
- An empty WAL may be created where none existed.

The database is never deleted or recreated. Android keeps its non-destructive `DatabaseErrorHandler`.

## Why SHM is excluded

The `-shm` file is SQLite's WAL index. It is a volatile cache derived from the WAL, and any connection that opens a WAL database rebuilds it after a crash, including a read-only connection. See the [WAL-index format](https://www.sqlite.org/walformat.html#the_wal_index_or_shm_file) and [read-only WAL databases](https://www.sqlite.org/wal.html#read_only_databases).

The f06ef71 investigation measured this directly. A read-only preflight on crash-left fixtures changed only SHM on Pixel_9 (platform SQLite 3.44.3) and on iPhone 17 Pro (SQLite 3.51.0), with both nonempty and empty WALs. Requiring byte-identical SHM would forbid reading the store at all, and it protects no data. On Android, `SQLiteDatabase` exposes no `sqlite3_db_config` or file control, so close-time controls cannot be set through the public API.

## Design

The design is the same on both platforms. It uses only public platform SQLite APIs: no C shim, reflection, private symbols, or custom VFS.

1. **Cached writers.** Each store identity has one writable connection, which is cached for the process lifetime and never closed. All access runs inside the shared `RadicalStorageOwner`.
2. **Read-only preflight.** Before the first writable open of a database in a process, Radical opens it read-only. It reads the schema and one `radical_kv` row, not a full `integrity_check`. On `SQLITE_CORRUPT`, `SQLITE_NOTADB`, or Android's `SQLiteDatabaseCorruptException`, it closes the read-only connection, which cannot checkpoint. It then quarantines the identity and fails with `StorageIOFailed`. No writable connection is opened on that path. Other preflight failures cache nothing, so a later call retries.
3. **Empty WAL before the preflight.** SQLite can open a WAL database read-only only if its `-wal` file exists or can be created, and Apple's SQLite returns `SQLITE_CANTOPEN` instead of creating it. A healthy WAL-mode database can lack a WAL, for example after a clean close or a restore of only the database file. If the header's write version (byte 18) is 2 and no WAL exists, Radical creates an empty one with `O_CREAT | O_EXCL | O_NOFOLLOW` and the database's permission bits. The contract allows this change.
4. **Quarantine.** If a cached writer reports corruption mid-operation, Radical does not close it, because closing the last writer can checkpoint. The identity stays quarantined for the rest of the process. The handle stays referenced and never runs another statement, and every later call fails with `StorageIOFailed` before the foundation resolves any path. At process exit the OS releases the handle without a SQLite close. On the next launch, the preflight finds the corruption again.
5. **Healthy durability.** The cached writer uses WAL with `synchronous=FULL`, so every committed `set`, `remove`, or `clear` is durable. SQLite's automatic checkpoint, at the platform default, keeps the WAL bounded. Each mutation is a single autocommit statement.

Settled behavior from earlier rounds is unchanged: iOS UTF-8 buffer binding, explicit row replacement, `{ found: false }` for a missing key, `InvalidStoredValue` for corrupt JSON, and the 1,048,576-byte limit.

### Residual on Android

`SQLiteDatabase.openDatabase` runs its own open-time PRAGMAs. If one of them fails, the framework disposes the connection itself. The preflight has already read the same schema read-only, so corruption is reported before this point. A non-corruption I/O failure inside the framework's open is outside what the public API lets Radical control.

## Native host regression

[KeyValueWALTest.swift](../../../packages/radical/tests/native-behavior/KeyValueWALTest.swift) compiles the production `RadicalStorageOwner`, `RadicalKeyValueSQLite`, and `RadicalKeyValueConnection` sources against the host's SQLite. [key-value-wal-probe.py](../../../packages/radical/tests/native-behavior/key-value-wal-probe.py) drives it and exits nonzero if any case fails.

```sh
python3 packages/radical/tests/native-behavior/key-value-wal-probe.py
```

Each case seeds its own database in a child process that exits without `sqlite3_close`, so the files are genuinely crash-left. The fixtures are:

| Fixture | Setup | Expected |
| --- | --- | --- |
| Nonempty WAL | Commit, checkpoint TRUNCATE, commit an update; offset 100 corrupted | Fails; database and WAL unchanged |
| Empty WAL | Commit, checkpoint TRUNCATE; offset 100 corrupted | Fails; database and WAL unchanged |
| Orphan SHM | Empty-WAL fixture with the WAL removed | Fails; database unchanged; empty WAL created |
| Mid-session | Healthy cached writer; another connection commits; `radical_kv` root pages corrupted | Same cached entry fails, is quarantined, keeps its handle |
| Clean | Healthy database closed, then `-wal` and `-shm` removed | Succeeds |

Each corrupt fixture runs `get`, `set`, and `clear`. The probe records file state before the call, after it, after three more refused calls, and after the process exits. It asserts unchanged existence, length, and SHA-256 for the database and WAL, allowing only creation of an empty WAL where none existed. It records SHM changes without asserting on them. The mid-session case also reads back `synchronous=2` and a positive `wal_autocheckpoint`.

[Results](host-wal.json): 15 of 15 cases pass. All twelve corrupt cases change SHM. The three orphan-SHM cases also create a 0-byte WAL. With the empty-WAL step disabled, the clean and orphan-SHM cases fail with `SQLITE_CANTOPEN`, so 9 of 15 pass. That run shows the step is required.

The existing native host tests also pass: KeyValueSQLiteTest, StorageOwnerTest, and StorageBackupTest.

## Device verification

The device harness is ready. [instrument-corruption.py](instrument-corruption.py) inserts [Android](wal-android.java) and [iOS](wal-ios.swift) fixtures into generated sources only. [wal-probe.html](wal-probe.html) runs the nonempty-WAL, empty-WAL, orphan-SHM, and mid-session fixtures in three stages: seed and crash, check and crash, then relaunch and recheck. Serve it as `index.html` on the example's `localhost:4173` origin, with `GET /stage/<platform>`, `POST /seed/<platform>`, `POST` and `GET /before-exit/<platform>`, and `POST /results/<platform>`. Launch and relaunch the app only with the `agent-device` command from `device_open`, and use a fresh install for each run.

With JDK 21, the instrumented Android shell built and the instrumented iOS shell built for the simulator. The first Android build failed with `error: unreported exception InterruptedIOException; must be caught or declared to be thrown` at `Os.pread`. The template now declares `IOException`, and the rebuild passed.

The runs could not start. Each device was held by an `agent-device` session from an earlier, interrupted run, and every `open` returned `Error (DEVICE_IN_USE): Device is already in use by session …`, including after a 60-second `--wait`. That session was not closed or reused, because it belongs to another run. Device fingerprints for the shipped design are still required before this contract counts as verified on Android and iOS.

The earlier f06ef71 device observations remain as SHM evidence: [Android](android/wal.json) and [iOS](ios/wal.json), with [seed metadata](android/wal-seeds.json). Their read-only preflight rows show only SHM changing.
