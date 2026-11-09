import Capacitor
import Darwin
import Foundation
import SQLite3

@objc(RadicalKeyValuePlugin)
public class RadicalKeyValuePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalKeyValuePlugin"
    public let jsName = "RadicalKeyValue"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "execute", returnType: CAPPluginReturnPromise)]
    private enum Failure: Error { case io }
    @objc public func execute(_ call: CAPPluginCall) {
        guard call.getString("capability") == "keyValue", call.getString("path") == "",
              let operation = call.getString("operation"), ["get", "set", "remove", "clear"].contains(operation),
              let key = call.getString("key"), key.utf16.count <= 1024,
              operation == "clear" || !key.isEmpty,
              operation != "set" || (call.getString("json").map { $0.utf8.count <= 1048576 } == true)
        else { call.reject("Invalid storage input", "InvalidStorageInput", nil, [:]); return }
        if operation == "set" {
            guard let data = call.getString("json")?.data(using: .utf8),
                  (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
            else { call.reject("Invalid storage input", "InvalidStorageInput", nil, [:]); return }
        }
        RadicalAppStoragePlugin().resolveStore(call) { root in
            let database = root.appendingPathComponent("key-value.sqlite")
            let excluded = call.getString("backup") != "eligible"
            func sidecars() throws {
                for suffix in ["", "-wal", "-shm", "-journal"] {
                    let url = URL(fileURLWithPath: database.path + suffix)
                    let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
                    if fd < 0 {
                        if errno == ENOENT { continue }
                        throw Failure.io
                    }
                    defer { close(fd) }
                    var info = stat()
                    guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw Failure.io }
                    try RadicalStorageBackup.apply(to: fd, at: url, excluded: excluded)
                }
            }
            try sidecars()
            var db: OpaquePointer?
            guard sqlite3_open_v2(database.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK else {
                if db != nil { sqlite3_close(db) }
                throw Failure.io
            }
            defer { sqlite3_close(db) }
            func sql(_ text: String) throws {
                guard sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK else { throw Failure.io }
            }
            try sql("PRAGMA journal_mode=WAL")
            try sidecars()
            try sql("CREATE TABLE IF NOT EXISTS radical_kv (namespace TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(namespace,key))")
            let text: String
            switch operation {
            case "get": text = "SELECT json FROM radical_kv WHERE namespace=? AND key=?"
            case "set": text = "INSERT OR REPLACE INTO radical_kv(namespace,key,json) VALUES(?,?,?)"
            case "remove": text = "DELETE FROM radical_kv WHERE namespace=? AND key=?"
            default: text = "DELETE FROM radical_kv WHERE namespace=?"
            }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, text, -1, &statement, nil) == SQLITE_OK else { throw Failure.io }
            defer { sqlite3_finalize(statement) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            var values = [call.getString("namespace")!]
            if operation != "clear" { values.append(key) }
            if operation == "set" { values.append(call.getString("json")!) }
            for (index, value) in values.enumerated() {
                let status = value.withCString { sqlite3_bind_text(statement, Int32(index + 1), $0, Int32(value.utf8.count), transient) }
                guard status == SQLITE_OK else { throw Failure.io }
            }
            let status = sqlite3_step(statement)
            var result: [String: Any] = [:]
            if operation == "get", status == SQLITE_ROW {
                let count = Int(sqlite3_column_bytes(statement, 0))
                guard let bytes = sqlite3_column_text(statement, 0), let json = String(bytes: UnsafeBufferPointer(start: bytes, count: count), encoding: .utf8) else { throw Failure.io }
                result["json"] = json
            } else if status != SQLITE_DONE { throw Failure.io }
            try sidecars()
            call.resolve(result)
        }
    }
}
