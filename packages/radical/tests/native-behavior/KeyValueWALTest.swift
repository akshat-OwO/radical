import CryptoKit
import Darwin
import Foundation
import SQLite3

@main
struct KeyValueWALTest {
    static func sql(_ db: OpaquePointer?, _ text: String) {
        precondition(sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK)
    }
    static func seed(_ path: String, _ scenario: String) {
        var db: OpaquePointer?
        precondition(sqlite3_open(path, &db) == SQLITE_OK)
        sql(db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE radical_kv(namespace TEXT,key TEXT,json TEXT,PRIMARY KEY(namespace,key)); INSERT INTO radical_kv VALUES('user','key','1')")
        let large = scenario.hasPrefix("large")
        // Large fixtures: 600 single-page rows. Same-size updates after the checkpoint
        // put about 2.5 MB in the WAL, above Android's 1 MiB open-time truncate size,
        // without rewriting page 1.
        if large { sql(db, "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<599) INSERT INTO radical_kv SELECT 'user', 'row' || i, '\"' || printf('%.2998c', 'a') || '\"' FROM n") }
        sql(db, "PRAGMA wal_checkpoint(TRUNCATE)")
        if large { sql(db, "PRAGMA wal_autocheckpoint=0; UPDATE radical_kv SET json='\"' || printf('%.2998c', 'b') || '\"' WHERE key LIKE 'row%'") }
        if scenario == "nonempty" { sql(db, "UPDATE radical_kv SET json='2'") }
        if scenario == "clean" {
            // A healthy WAL-mode database without sidecars, as after a clean close
            // or a restore of only the database file. Apple's SQLite persists the
            // WAL by default, so remove both sidecars explicitly.
            precondition(sqlite3_close(db) == SQLITE_OK)
            for suffix in ["-wal", "-shm"] { unlink(path + suffix) }
        }
        _exit(0) // Genuine crash-left files: no SQLite close or process destructors.
    }
    static func snapshot(_ path: String) throws -> [String: Any] {
        var files: [String: Any] = [:]
        for (name,suffix) in [("database",""),("wal","-wal"),("shm","-shm"),("journal","-journal")] {
            let url = URL(fileURLWithPath: path + suffix)
            var state: [String: Any] = ["exists": FileManager.default.fileExists(atPath: url.path)]
            if FileManager.default.fileExists(atPath: url.path) {
                let data = try Data(contentsOf: url)
                state["bytes"] = data.count
                state["sha256"] = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            }
            files[name] = state
        }
        return files
    }
    static func mutate(_ path: String, _ offsets: [UInt64]) throws {
        let file = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
        defer { try? file.close() }
        for offset in offsets { try file.seek(toOffset: offset); try file.write(contentsOf: Data([255])) }
        try file.synchronize()
    }
    static func operate(_ entry: RadicalKeyValueConnections.Entry, _ operation: String) throws {
        let text: String
        switch operation {
        case "get": text = "SELECT json FROM radical_kv WHERE namespace='user' AND key='key'"
        case "set": text = "INSERT OR REPLACE INTO radical_kv VALUES('user','key','3')"
        default: text = "DELETE FROM radical_kv WHERE namespace='user'"
        }
        var statement: OpaquePointer?
        try entry.check(sqlite3_prepare_v2(entry.database, text, -1, &statement, nil))
        defer { sqlite3_finalize(statement) }
        try entry.check(sqlite3_step(statement), accepting: [SQLITE_ROW, SQLITE_DONE])
    }
    static func main() throws {
        let args = CommandLine.arguments
        let path = args[2]
        if args[1] == "seed" { seed(path, args[3]) }
        var report: [String: Any] = [:]
        try RadicalStorageOwner.withMutation {
            let identity = path
            var entry: RadicalKeyValueConnections.Entry?
            if args[1] == "mid" {
                let healthy = try RadicalKeyValueConnections.connection(identity, at: URL(fileURLWithPath: path))
                entry = healthy
                sql(healthy.database, "INSERT OR REPLACE INTO radical_kv VALUES('user','key','1'); CREATE TABLE wal_marker(value TEXT); INSERT INTO wal_marker VALUES('one'); PRAGMA wal_checkpoint(TRUNCATE)")
                var settings: [String: Int] = [:]
                for pragma in ["synchronous", "wal_autocheckpoint"] {
                    var statement: OpaquePointer?
                    precondition(sqlite3_prepare_v2(healthy.database, "PRAGMA " + pragma, -1, &statement, nil) == SQLITE_OK)
                    precondition(sqlite3_step(statement) == SQLITE_ROW)
                    settings[pragma] = Int(sqlite3_column_int(statement, 0))
                    sqlite3_finalize(statement)
                }
                report["settings"] = settings
                var pageSizeStatement: OpaquePointer?
                precondition(sqlite3_prepare_v2(healthy.database, "PRAGMA page_size", -1, &pageSizeStatement, nil) == SQLITE_OK)
                precondition(sqlite3_step(pageSizeStatement) == SQLITE_ROW)
                let pageSize = UInt64(sqlite3_column_int(pageSizeStatement, 0))
                sqlite3_finalize(pageSizeStatement)
                var roots: OpaquePointer?
                precondition(sqlite3_prepare_v2(healthy.database, "SELECT rootpage FROM sqlite_master WHERE tbl_name='radical_kv' AND rootpage>0", -1, &roots, nil) == SQLITE_OK)
                var offsets: [UInt64] = []
                while sqlite3_step(roots) == SQLITE_ROW { offsets.append(UInt64(sqlite3_column_int(roots, 0) - 1) * pageSize) }
                sqlite3_finalize(roots)
                // A separate committed connection changes the WAL data version, so
                // the cached writer must re-read pages on its next transaction.
                var other: OpaquePointer?
                precondition(sqlite3_open(path, &other) == SQLITE_OK)
                sql(other, "PRAGMA synchronous=FULL; UPDATE wal_marker SET value='two'")
                precondition(sqlite3_close(other) == SQLITE_OK)
                try mutate(path, offsets)
            } else {
                if args[3] == "orphan-shm" { try FileManager.default.removeItem(atPath: path + "-wal") }
                if args[3] != "clean" && args[3] != "large-healthy" { try mutate(path, [100]) }
            }
            report["before"] = try snapshot(path)
            do {
                let connection = try RadicalKeyValueConnections.connection(identity, at: URL(fileURLWithPath: path))
                if let entry { report["sameCachedEntry"] = entry === connection }
                try operate(connection, args[4])
                report["failed"] = false
                if args[3] == "large-healthy" {
                    var count: OpaquePointer?
                    try connection.check(sqlite3_prepare_v2(connection.database, "SELECT count(*) FROM radical_kv WHERE key LIKE 'row%' AND json='\"' || printf('%.2998c', 'b') || '\"'", -1, &count, nil))
                    try connection.check(sqlite3_step(count), accepting: [SQLITE_ROW])
                    report["committedRows"] = Int(sqlite3_column_int(count, 0))
                    sqlite3_finalize(count)
                }
            } catch {
                report["failed"] = true
            }
            report["after"] = try snapshot(path)
            var refused = true
            for _ in 0..<3 {
                do { try RadicalKeyValueConnections.requireUsable(identity); refused = false } catch {}
            }
            report["laterCallsRefused"] = refused
            report["afterLaterCalls"] = try snapshot(path)
            if let entry {
                report["quarantined"] = entry.quarantined
                report["handleRetained"] = entry.database != nil
            }
        }
        print(String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), as: UTF8.self))
        // Cached pointers deliberately have no close/deinit; process exit releases them.
    }
}
