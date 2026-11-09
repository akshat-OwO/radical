import Foundation
import SQLite3

@main
struct KeyValueSQLiteTest {
    static func main() throws {
        var db: OpaquePointer?
        precondition(sqlite3_open(":memory:", &db) == SQLITE_OK)
        defer { sqlite3_close(db) }
        precondition(sqlite3_exec(db, "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)", nil, nil, nil) == SQLITE_OK)
        var checks: [String: Bool] = [:]

        func statement(_ sql: String) -> OpaquePointer {
            var result: OpaquePointer?
            precondition(sqlite3_prepare_v2(db, sql, -1, &result, nil) == SQLITE_OK)
            return result!
        }
        func put(_ key: String, _ value: String) throws {
            let insert = statement("INSERT INTO kv(key,value) VALUES(?,?)")
            defer { sqlite3_finalize(insert) }
            try RadicalKeyValueSQLite.bindText(key, to: insert, at: 1)
            try RadicalKeyValueSQLite.bindText(value, to: insert, at: 2)
            precondition(sqlite3_step(insert) == SQLITE_DONE)
        }
        func read(_ key: String) throws -> String? {
            let query = statement("SELECT value FROM kv WHERE key=?")
            defer { sqlite3_finalize(query) }
            try RadicalKeyValueSQLite.bindText(key, to: query, at: 1)
            let status = sqlite3_step(query)
            if status == SQLITE_DONE { return nil }
            precondition(status == SQLITE_ROW)
            return try RadicalKeyValueSQLite.text(from: query, at: 0)
        }

        let nul = String(UnicodeScalar(0))
        let key = "a" + nul + "b🦊"
        let value = "before" + nul + "afteré"
        try put(key, value)
        checks["nul-key-and-text-round-trip"] = try read(key) == value
        checks["nul-key-prefix-is-distinct"] = try read("a") == nil
        checks["nul-key-suffix-is-distinct"] = try read("a" + nul + "b") == nil

        let json = String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]), as: UTF8.self)
        try put("json", json)
        let storedJSON = try read("json")!
        checks["json-nul-round-trip"] = try JSONSerialization.jsonObject(with: Data(storedJSON.utf8), options: [.fragmentsAllowed]) as? String == value

        try put("", "")
        checks["empty-text-is-not-null"] = try read("") == ""
        let query = statement("SELECT key, length(CAST(value AS BLOB)) FROM kv WHERE key=?")
        try RadicalKeyValueSQLite.bindText(key, to: query, at: 1)
        precondition(sqlite3_step(query) == SQLITE_ROW)
        checks["read-full-key-by-byte-length"] = try RadicalKeyValueSQLite.text(from: query, at: 0) == key
        checks["bound-count-is-utf8-count"] = sqlite3_column_int(query, 1) == Int32(value.utf8.count)
        sqlite3_finalize(query)

        let remove = statement("DELETE FROM kv WHERE key=?")
        try RadicalKeyValueSQLite.bindText(key, to: remove, at: 1)
        precondition(sqlite3_step(remove) == SQLITE_DONE)
        sqlite3_finalize(remove)
        checks["remove-full-nul-key"] = try read(key) == nil
        checks["remove-preserves-other-rows"] = try read("json") == json

        let data = try JSONSerialization.data(withJSONObject: ["checks": checks], options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        precondition(checks.values.allSatisfy { $0 }, "SQLite text checks failed")
    }
}
