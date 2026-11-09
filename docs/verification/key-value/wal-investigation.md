# WAL failure-preservation contract

This record states how native key-value storage treats SQLite files once it detects corruption, why the shared-memory index is excluded, what normal SQLite maintenance still runs on a database that passes the preflight, and the evidence. It supersedes the earlier candidate investigation recorded at f06ef71.

**Status:** verified. The native host regression passes, and the device regression passes on Pixel_9 (Android 16) and iPhone 17 Pro (iOS 26.5).

## Contract

After Radical detects corruption, through a failed preflight or a quarantined connection, it never checkpoints, truncates, deletes, or reinitializes the main database or the WAL. Their existence, length, and SHA-256 stay unchanged.

Two changes are allowed because neither holds data:

- The `-shm` file may change.
- An empty WAL may be created where none existed.

A database that passes the preflight is treated as healthy, and normal SQLite maintenance applies:

- On Android, the platform's writable open runs `PRAGMA wal_checkpoint(TRUNCATE)` when the WAL is at least `db_wal_truncate_size`. The AOSP default is 1,048,576 bytes. AOSP runs this in `SQLiteConnection.maybeTruncateWalFile`, and no public `openDatabase` flag disables it. Read-only connections skip it.
- On both platforms, SQLite runs automatic checkpoints on commit.

A checkpoint copies committed WAL frames into the main file, so no committed data is lost. The database is never deleted or recreated. Android keeps its non-destructive `DatabaseErrorHandler`.

## Why SHM is excluded

The `-shm` file is SQLite's WAL index. It is a volatile cache derived from the WAL. Any connection that opens a WAL database rebuilds it after a crash, including a read-only connection. See the [WAL-index format](https://www.sqlite.org/walformat.html#the_wal_index_or_shm_file) and [read-only WAL databases](https://www.sqlite.org/wal.html#read_only_databases).

Every corrupt fixture below changed SHM during the read-only preflight on both devices. Requiring byte-identical SHM would forbid reading the store at all, and it protects no data. On Android, `SQLiteDatabase` exposes no `sqlite3_db_config` or file control, so close-time controls cannot be set through the public API.

## Design

The design is the same on both platforms. It uses only public platform SQLite APIs: no C shim, reflection, private symbols, or custom VFS.

1. **Cached writers.** Each store identity has one writable connection, which is cached for the process lifetime and never closed, because closing the last writer can checkpoint. All access runs inside the shared `RadicalStorageOwner`.
2. **Read-only preflight.** Before the first writable open of a database in a process, Radical opens it read-only. It reads the schema and one `radical_kv` row. On `SQLITE_CORRUPT`, `SQLITE_NOTADB`, or Android's `SQLiteDatabaseCorruptException`, it closes the read-only connection, which cannot checkpoint. It then quarantines the identity and fails with `StorageIOFailed`. No writable connection is opened on that path, so Android's open-time truncate never runs on a store the preflight rejected. Other preflight failures cache nothing, so a later call retries.
3. **Empty WAL before the preflight.** SQLite can open a WAL database read-only only if its `-wal` file exists or can be created, and Apple's SQLite returns `SQLITE_CANTOPEN` instead of creating it. A healthy WAL-mode database can lack a WAL, for example after a clean close or a restore of only the database file. If the header's write version (byte 18) is 2 and no WAL exists, Radical creates an empty one with `O_CREAT | O_EXCL | O_NOFOLLOW` and the database's permission bits.
4. **Quarantine.** If a cached writer reports corruption mid-operation, Radical does not close it. The identity stays quarantined for the rest of the process. The handle stays referenced and never runs another statement, and every later call fails with `StorageIOFailed` before the foundation resolves any path. At process exit the OS releases the handle without a SQLite close. Quarantine ends with the process. On the next launch, the preflight finds the corruption again if it reads the damaged page; otherwise the first statement that reads it reports and quarantines it again.
5. **Healthy durability.** The cached writer uses WAL with `synchronous=FULL`, so every committed `set`, `remove`, or `clear` is durable. SQLite's automatic checkpoint, at the platform default, keeps the WAL bounded: 100 pages on Pixel_9 and 1,000 on iOS. Each mutation is a single autocommit statement.

### Why the preflight is not an integrity check

`PRAGMA integrity_check` and `quick_check` read every page, so their cost grows with the database. A store opens once per process, so a full scan would delay the first key-value call in every launch, and it would have to finish before Android's writable open. The preflight instead reads the schema and one row. It catches damage to the schema or the table's first pages, which are the structures every operation reads first.

Corruption deeper in the file can pass the preflight. The store is then treated as healthy until a statement reads the damaged page. That statement fails, and the identity is quarantined from that point on. A checkpoint that ran earlier, including Android's open-time truncate of a large WAL, is normal maintenance on a database that SQLite could read, not a reset. It moved committed frames into the main file.

### Remaining limit on Android

`SQLiteDatabase.openDatabase` runs its own open-time PRAGMAs. If one of them fails, the framework closes that connection itself. Corruption in the pages the preflight reads is reported before this point. A non-corruption I/O failure inside the framework's open is outside what the public API lets Radical control.

## Native host regression

[KeyValueWALTest.swift](../../../packages/radical/tests/native-behavior/KeyValueWALTest.swift) compiles the production `RadicalStorageOwner`, `RadicalKeyValueSQLite`, and `RadicalKeyValueConnection` sources against the host's SQLite. [key-value-wal-probe.py](../../../packages/radical/tests/native-behavior/key-value-wal-probe.py) drives it and exits nonzero if any case fails.

```sh
python3 packages/radical/tests/native-behavior/key-value-wal-probe.py
```

Each case seeds its own database in a child process that exits without `sqlite3_close`, so the files are genuinely crash-left.

| Fixture | Setup | Expected |
| --- | --- | --- |
| Nonempty WAL | Commit, checkpoint TRUNCATE, commit an update; offset 100 corrupted | Fails; database and WAL unchanged |
| Empty WAL | Commit, checkpoint TRUNCATE; offset 100 corrupted | Fails; database and WAL unchanged |
| Orphan SHM | Empty-WAL fixture with the WAL removed | Fails; database unchanged; empty WAL created |
| Mid-session | Healthy cached writer; another connection commits; `radical_kv` root pages corrupted | Same cached entry fails, is quarantined, keeps its handle |
| Clean | Healthy database closed, then `-wal` and `-shm` removed | Succeeds |
| Large WAL | 600 single-page rows checkpointed, then same-size updates leave a 2,472,032-byte WAL; offset 100 corrupted | Fails; database and WAL unchanged |
| Large WAL, healthy | Same seed without corruption | Succeeds; all 600 committed rows readable |

The large fixtures exceed Android's 1,048,576-byte truncate threshold. Same-size updates keep page 1 out of the WAL, so the offset-100 damage is visible to the preflight.

Each corrupt fixture runs `get`, `set`, and `clear`. The probe records file state before the call, after it, after three more refused calls, and after the process exits. It asserts unchanged existence, length, and SHA-256 for the database and WAL, allowing only creation of an empty WAL where none existed. It records SHM changes without asserting on them.

[Results](host-wal.json): 19 of 19 cases pass. With the empty-WAL step disabled, the clean and orphan-SHM cases fail with `SQLITE_CANTOPEN`, which shows the step is required. The host exercises the iOS code path. Android's open-time truncate is covered on the device.

The existing native host tests also pass: KeyValueSQLiteTest, StorageOwnerTest, and StorageBackupTest.

## Device regression

[instrument-corruption.py](instrument-corruption.py) inserts the [Android](wal-android.java) and [iOS](wal-ios.swift) fixtures into generated sources only. [wal-probe.html](wal-probe.html) runs the host fixtures in three app launches:

1. Seed every crash-left fixture, then terminate the process without a SQLite close.
2. Damage each fixture and run the operation. For a corrupt fixture, run `get`, `set`, and `clear` again to confirm refusal, record the files, then terminate.
3. Relaunch, record the files again, and run the operation once more. A corrupt store must fail in the new process's preflight with its files unchanged. The clean and large healthy stores must still hold their committed values.

Every launch and relaunch used the `agent-device` command from `device_open`. Each platform used a fresh install.

[Android results](android/wal.json): 19 of 19 pass on Pixel_9 (Android 16, platform SQLite 3.44.3). [iOS results](ios/wal.json): 19 of 19 pass on iPhone 17 Pro (iOS 26.5).

Short hashes are the first 12 hex digits of SHA-256. For corrupt fixtures, "after" is the state after the process exited and relaunched. For clean and large healthy stores, "after" is the state after the operation. Each JSON file also records the state immediately after the call and after the refused calls.

### Android

| Fixture | Op | Result | Database before | Database after exit | WAL before | WAL after exit | Other changes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nonempty | get | StorageIOFailed | 16384 B `6f217d0cd5e3` | 16384 B `6f217d0cd5e3` | 4152 B `c2000d6e1583` | 4152 B `c2000d6e1583` | shm |
| nonempty | set | StorageIOFailed | 16384 B `af38bd693b09` | 16384 B `af38bd693b09` | 4152 B `adb06bd70fc5` | 4152 B `adb06bd70fc5` | shm |
| nonempty | clear | StorageIOFailed | 16384 B `5660ea3141b4` | 16384 B `5660ea3141b4` | 4152 B `d5ccdc2dab59` | 4152 B `d5ccdc2dab59` | shm |
| empty | get | StorageIOFailed | 16384 B `536c5f4d32d7` | 16384 B `536c5f4d32d7` | 0 B `e3b0c44298fc` | 0 B `e3b0c44298fc` | shm |
| empty | set | StorageIOFailed | 16384 B `e2ad4d4c5c34` | 16384 B `e2ad4d4c5c34` | 0 B `e3b0c44298fc` | 0 B `e3b0c44298fc` | shm |
| empty | clear | StorageIOFailed | 16384 B `de779349b38a` | 16384 B `de779349b38a` | 0 B `e3b0c44298fc` | 0 B `e3b0c44298fc` | shm |
| orphan-shm | get | StorageIOFailed | 16384 B `9278f45480b9` | 16384 B `9278f45480b9` | absent | 0 B `e3b0c44298fc` | wal, shm |
| orphan-shm | set | StorageIOFailed | 16384 B `2146f4abc5a4` | 16384 B `2146f4abc5a4` | absent | 0 B `e3b0c44298fc` | wal, shm |
| orphan-shm | clear | StorageIOFailed | 16384 B `a9aada5a9c14` | 16384 B `a9aada5a9c14` | absent | 0 B `e3b0c44298fc` | wal, shm |
| mid | get | StorageIOFailed | 20480 B `94210ea77b54` | 20480 B `94210ea77b54` | 4152 B `3c6a6213e811` | 4152 B `3c6a6213e811` | shm |
| mid | set | StorageIOFailed | 20480 B `ea2c12522ca5` | 20480 B `ea2c12522ca5` | 4152 B `c633788ef083` | 4152 B `c633788ef083` | shm |
| mid | clear | StorageIOFailed | 20480 B `ce0e6a7a23d4` | 20480 B `ce0e6a7a23d4` | 4152 B `ff20b0ead720` | 4152 B `ff20b0ead720` | shm |
| clean | get | ok | 16384 B `b667c3b411b3` | 16384 B `b667c3b411b3` | absent | 0 B `e3b0c44298fc` | wal, shm |
| clean | set | ok | 16384 B `e57f2487fff8` | 16384 B `e57f2487fff8` | absent | 8272 B `6e326615a3cd` | wal, shm |
| clean | clear | ok | 16384 B `7b52ff033a33` | 16384 B `7b52ff033a33` | absent | 8272 B `bf205fd89d96` | wal, shm |
| large | get | StorageIOFailed | 2498560 B `759f8a18ec0b` | 2498560 B `759f8a18ec0b` | 2472032 B `93a2bbd3a25e` | 2472032 B `93a2bbd3a25e` | shm |
| large | set | StorageIOFailed | 2498560 B `33c40a622cb8` | 2498560 B `33c40a622cb8` | 2472032 B `1e19e5f47a50` | 2472032 B `1e19e5f47a50` | shm |
| large | clear | StorageIOFailed | 2498560 B `fff61a41048b` | 2498560 B `fff61a41048b` | 2472032 B `f01577b42962` | 2472032 B `f01577b42962` | shm |
| large-healthy | get | ok, 600/600 rows | 2502656 B `46c189ab5c01` | 2502656 B `0346f3d5682b` | 2472032 B `84113749abd5` | 0 B `e3b0c44298fc` | database, wal, shm |

The large healthy row shows Android's open-time truncate: the writable open checkpointed the 2,472,032-byte WAL into the database and truncated the WAL to 0 bytes. All 600 committed rows were readable after the open and again after relaunch. In the large corrupt rows, the preflight rejected the store, no writable open ran, and the WAL kept its length and hash.

### iOS

| Fixture | Op | Result | Database before | Database after exit | WAL before | WAL after exit | Other changes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nonempty | get | StorageIOFailed | 12288 B `7a4782215c36` | 12288 B `7a4782215c36` | 4152 B `ae1c17119c9c` | 4152 B `ae1c17119c9c` | shm |
| nonempty | set | StorageIOFailed | 12288 B `7b52644b65b4` | 12288 B `7b52644b65b4` | 4152 B `82c97fde19ba` | 4152 B `82c97fde19ba` | shm |
| nonempty | clear | StorageIOFailed | 12288 B `0d54e23a1c9e` | 12288 B `0d54e23a1c9e` | 4152 B `25f184ba2018` | 4152 B `25f184ba2018` | shm |
| empty | get | StorageIOFailed | 12288 B `2765916a1307` | 12288 B `2765916a1307` | 0 B `e3b0c44298fc` | 0 B `e3b0c44298fc` | shm |
| empty | set | StorageIOFailed | 12288 B `2fb252188147` | 12288 B `2fb252188147` | 0 B `e3b0c44298fc` | 0 B `e3b0c44298fc` | shm |
| empty | clear | StorageIOFailed | 12288 B `62b2360f6d4b` | 12288 B `62b2360f6d4b` | 0 B `e3b0c44298fc` | 0 B `e3b0c44298fc` | shm |
| orphan-shm | get | StorageIOFailed | 12288 B `0282ae46553a` | 12288 B `0282ae46553a` | absent | 0 B `e3b0c44298fc` | shm, wal |
| orphan-shm | set | StorageIOFailed | 12288 B `3e80cb6e9b2b` | 12288 B `3e80cb6e9b2b` | absent | 0 B `e3b0c44298fc` | wal, shm |
| orphan-shm | clear | StorageIOFailed | 12288 B `ee81580b935e` | 12288 B `ee81580b935e` | absent | 0 B `e3b0c44298fc` | wal, shm |
| mid | get | StorageIOFailed | 16384 B `f21dbd83f6da` | 16384 B `f21dbd83f6da` | 4152 B `d2bf09a6b8d8` | 4152 B `d2bf09a6b8d8` | shm |
| mid | set | StorageIOFailed | 16384 B `aac276d0f874` | 16384 B `aac276d0f874` | 4152 B `5823db8ae4c9` | 4152 B `5823db8ae4c9` | shm |
| mid | clear | StorageIOFailed | 16384 B `450485e9365a` | 16384 B `450485e9365a` | 4152 B `59e13bd95a67` | 4152 B `59e13bd95a67` | shm |
| clean | get | ok | 12288 B `6e77f86ef457` | 12288 B `6e77f86ef457` | absent | 0 B `e3b0c44298fc` | shm, wal |
| clean | set | ok | 12288 B `5c9f84b9b6fa` | 12288 B `5c9f84b9b6fa` | absent | 8272 B `38541cc7edea` | shm, wal |
| clean | clear | ok | 12288 B `33c30f141b9f` | 12288 B `33c30f141b9f` | absent | 8272 B `3cfa8a63d186` | wal, shm |
| large | get | StorageIOFailed | 2494464 B `b36e548c3cc1` | 2494464 B `b36e548c3cc1` | 2472032 B `e08cc767214e` | 2472032 B `e08cc767214e` | shm |
| large | set | StorageIOFailed | 2494464 B `30d45538e4df` | 2494464 B `30d45538e4df` | 2472032 B `63b76fb39ee5` | 2472032 B `63b76fb39ee5` | shm |
| large | clear | StorageIOFailed | 2494464 B `800dc74d0e30` | 2494464 B `800dc74d0e30` | 2472032 B `74fbec427a28` | 2472032 B `74fbec427a28` | shm |
| large-healthy | get | ok, 600/600 rows | 2498560 B `4b0c103ea72a` | 2498560 B `4b0c103ea72a` | 2472032 B `3031a4bd59eb` | 2472032 B `3031a4bd59eb` | shm |

iOS has no open-time truncate, so the healthy large WAL stays in place and all 600 rows remain readable.

## Builds

With JDK 21, the instrumented Android shell built, and the instrumented iOS shell built for the simulator. The first Android build failed with `error: unreported exception InterruptedIOException; must be caught or declared to be thrown` at `Os.pread`. The template now declares `IOException`, and the rebuild passed.
