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
        let identity = (call.getString("store") ?? "") + "/" + (call.getString("namespace") ?? "")
        // Refuse a quarantined identity before the foundation resolves any path.
        RadicalAppStoragePlugin().resolveStore(call, beforeResolve: {
            try RadicalKeyValueConnections.requireUsable(identity)
        }) { root in
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
            let entry: RadicalKeyValueConnections.Entry
            do {
                entry = try RadicalKeyValueConnections.connection(identity, at: database)
            } catch {
                // The preflight may have created an empty WAL or rebuilt SHM.
                try? sidecars()
                throw error
            }
            let db = entry.database
            try sidecars()
            let text: String
            switch operation {
            case "get": text = "SELECT json FROM radical_kv WHERE namespace=? AND key=?"
            case "set": text = "INSERT OR REPLACE INTO radical_kv(namespace,key,json) VALUES(?,?,?)"
            case "remove": text = "DELETE FROM radical_kv WHERE namespace=? AND key=?"
            default: text = "DELETE FROM radical_kv WHERE namespace=?"
            }
            var statement: OpaquePointer?
            try entry.check(sqlite3_prepare_v2(db, text, -1, &statement, nil))
            defer { sqlite3_finalize(statement) }
            var values = [call.getString("namespace")!]
            if operation != "clear" { values.append(key) }
            if operation == "set" { values.append(call.getString("json")!) }
            for (index, value) in values.enumerated() {
                try RadicalKeyValueSQLite.bindText(value, to: statement, at: Int32(index + 1))
            }
            // A corrupt result quarantines the cached writer; it is never closed.
            let status = sqlite3_step(statement)
            try entry.check(status, accepting: operation == "get" ? [SQLITE_ROW, SQLITE_DONE] : [SQLITE_DONE])
            var result: [String: Any] = [:]
            if status == SQLITE_ROW {
                result["json"] = try RadicalKeyValueSQLite.text(from: statement, at: 0)
            }
            try sidecars()
            call.resolve(result)
        }
    }
}
