import Darwin
import Foundation
import SQLite3

/// One writable SQLite connection per key-value store identity, cached for the
/// process lifetime.
///
/// When the last writable connection to a WAL database closes, SQLite checkpoints
/// WAL frames into the main database and truncates or deletes the WAL. On a corrupt
/// store that would rewrite files after a failure. Radical therefore never closes a
/// writable connection it opened:
///
/// - Before the first writable open in a process, a read-only preflight reads the
///   schema and the first radical_kv row. A read-only connection cannot checkpoint,
///   so closing it on corruption leaves the main database and WAL unchanged. SQLite
///   may rebuild the volatile SHM index or create an empty WAL; neither holds data.
/// - If a cached writer reports corruption mid-operation, its identity is
///   quarantined: the handle stays referenced here, no statement ever runs on it
///   again, and every later call fails with StorageIOFailed without touching the
///   store files. The OS releases the handle at process exit without a SQLite close,
///   so no checkpoint runs. Quarantine ends with the process; the next launch reports
///   the corruption again when its preflight or a later statement reads the damaged page.
///
/// The preflight is not an integrity_check, which reads every page. A database that
/// passes it is treated as healthy, and automatic checkpoints on commit apply; they
/// move committed frames into the database and lose no data.
///
/// All access is serialized by RadicalStorageOwner.
enum RadicalKeyValueConnections {
    enum Failure: Error { case io, corrupt }

    final class Entry {
        /// Nil when the read-only preflight found corruption.
        fileprivate(set) var database: OpaquePointer?
        fileprivate(set) var quarantined = false
        fileprivate var initialized = false

        /// Maps a SQLite result to success or a typed failure. Corruption quarantines
        /// the entry; the handle is deliberately kept open (there is no deinit/close).
        func check(_ status: Int32, accepting: [Int32] = [SQLITE_OK]) throws {
            guard accepting.contains(status) else {
                if RadicalKeyValueConnections.isCorrupt(status) {
                    quarantined = true
                    throw Failure.corrupt
                }
                throw Failure.io
            }
        }
    }

    private static var entries: [String: Entry] = [:]

    static func isCorrupt(_ status: Int32) -> Bool {
        let primary = status & 0xff
        return primary == SQLITE_CORRUPT || primary == SQLITE_NOTADB
    }

    /// Refuses a quarantined identity before any of its files are touched.
    static func requireUsable(_ identity: String) throws {
        try RadicalStorageOwner.requireMutation()
        if entries[identity]?.quarantined == true { throw Failure.io }
    }

    /// SQLite opens a WAL database read-only only when its -wal file exists or can be
    /// created, and Apple's SQLite does not create it for a read-only connection
    /// (SQLITE_CANTOPEN). A WAL-mode database without a -wal file is valid, for
    /// example after a clean close or a restore. Create the empty WAL that a writable
    /// open would create. An empty WAL holds no frames, so no data changes.
    private static func ensureWAL(_ url: URL) throws {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw Failure.io }
        defer { close(fd) }
        var info = stat()
        var version: UInt8 = 0
        guard fstat(fd, &info) == 0 else { throw Failure.io }
        // Header byte 18 is the file format write version; 2 means WAL mode.
        guard pread(fd, &version, 1, 18) == 1, version == 2 else { return }
        let wal = open(url.path + "-wal", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, info.st_mode & 0o777)
        if wal >= 0 { close(wal) } else if errno != EEXIST { throw Failure.io }
    }

    /// Reads the schema and one radical_kv row, not an O(database size) integrity
    /// scan. It runs once per database per process because the writer is cached.
    private static func preflight(_ url: URL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try ensureWAL(url)
        var probe: OpaquePointer?
        let opened = sqlite3_open_v2(url.path, &probe, SQLITE_OPEN_READONLY, nil)
        // Closing a read-only connection cannot checkpoint into the database or WAL.
        defer { sqlite3_close(probe) }
        func step(_ sql: String) throws -> Int32 {
            var statement: OpaquePointer?
            defer { sqlite3_finalize(statement) }
            let prepared = sqlite3_prepare_v2(probe, sql, -1, &statement, nil)
            if isCorrupt(prepared) { throw Failure.corrupt }
            guard prepared == SQLITE_OK else { throw Failure.io }
            let status = sqlite3_step(statement)
            if isCorrupt(status) { throw Failure.corrupt }
            guard status == SQLITE_ROW || status == SQLITE_DONE else { throw Failure.io }
            return status
        }
        if isCorrupt(opened) { throw Failure.corrupt }
        guard opened == SQLITE_OK else { throw Failure.io }
        if try step("SELECT 1 FROM sqlite_master WHERE type='table' AND name='radical_kv' LIMIT 1") == SQLITE_ROW {
            _ = try step("SELECT namespace,key,json FROM radical_kv LIMIT 1")
        }
    }

    static func connection(_ identity: String, at url: URL) throws -> Entry {
        try requireUsable(identity)
        let entry: Entry
        if let cached = entries[identity] {
            entry = cached
        } else {
            entry = Entry()
            do {
                try preflight(url)
            } catch Failure.corrupt {
                // No writer exists. Refuse the identity until the process exits.
                entry.quarantined = true
                entries[identity] = entry
                throw Failure.corrupt
            }
            // Other preflight failures cache nothing, so a later call retries it.
            var database: OpaquePointer?
            let opened = sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil)
            guard opened == SQLITE_OK else {
                // open_v2 reads no pages, so this close has no WAL to checkpoint.
                sqlite3_close(database)
                throw Failure.io
            }
            entry.database = database
            entries[identity] = entry
        }
        if !entry.initialized {
            // FULL makes every committed set, remove, or clear durable in the WAL.
            // SQLite's default automatic checkpoint bounds the WAL. Failures keep the
            // open writer and retry these idempotent statements on the next call.
            for sql in [
                "PRAGMA journal_mode=WAL",
                "PRAGMA synchronous=FULL",
                "CREATE TABLE IF NOT EXISTS radical_kv(namespace TEXT NOT NULL,key TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(namespace,key))",
            ] {
                try entry.check(sqlite3_exec(entry.database, sql, nil, nil, nil))
            }
            entry.initialized = true
        }
        return entry
    }
}
