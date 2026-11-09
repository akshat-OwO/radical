import Capacitor
import Foundation

@objc(RadicalAppStoragePlugin)
public class RadicalAppStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalAppStoragePlugin"
    public let jsName = "RadicalAppStorage"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "resolve", returnType: CAPPluginReturnPromise)]
    private let queue = DispatchQueue(label: "radical.app-storage")
    private func validName(_ value: String) -> Bool {
        value.range(of: "^[a-z0-9][a-z0-9_-]{0,127}$", options: .regularExpression) != nil
    }
    private func confined(_ root: URL, _ relative: String) throws -> URL {
        var current = root
        for part in relative.split(separator: "/") {
            current.appendPathComponent(String(part))
            if FileManager.default.fileExists(atPath: current.path) {
                let values = try current.resourceValues(forKeys: [.isSymbolicLinkKey])
                if values.isSymbolicLink == true { throw StorageFailure.invalid }
            }
        }
        guard current.resolvingSymlinksInPath().path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else {
            throw StorageFailure.invalid
        }
        return current
    }
    private enum StorageFailure: Error { case invalid }
    private func directory(_ url: URL, excluded: Bool) throws {
        if FileManager.default.fileExists(atPath: url.path),
           try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true { throw StorageFailure.invalid }
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = excluded
        try target.setResourceValues(values)
    }
    @objc public func resolve(_ call: CAPPluginCall) {
        queue.async {
            guard let capability = call.getString("capability"),
                  ["keyValue", "secureStorage", "sqlite", "fileSystem"].contains(capability),
                  let store = call.getString("store"), self.validName(store),
                  let namespace = call.getString("namespace"), self.validName(namespace),
                  let backup = call.getString("backup"), ["eligible", "excluded", "cache"].contains(backup),
                  let path = call.getString("path"),
                  path.isEmpty || path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({
                      !$0.isEmpty && $0 != "." && $0 != ".." && $0.range(of: "[\\\\:\\x00-\\x1f]", options: .regularExpression) == nil
                  }) else { call.reject("Invalid storage input", "InvalidStorageInput"); return }
            do {
                let fm = FileManager.default
                let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let caches = try fm.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let eligible = try self.confined(support, "radical-storage/eligible")
                let excluded = try self.confined(support, "radical-storage/excluded")
                let cache = try self.confined(caches, "radical-storage")
                try self.directory(eligible, excluded: false)
                try self.directory(excluded, excluded: true)
                try self.directory(cache, excluded: true)
                let identity = capability + "/" + store + "/" + namespace
                let policies = try self.confined(excluded, "policies")
                try self.directory(policies, excluded: true)
                let policy = try self.confined(policies, identity)
                try self.directory(policy.deletingLastPathComponent(), excluded: true)
                if fm.fileExists(atPath: policy.path) {
                    if try String(contentsOf: policy, encoding: .utf8) != backup {
                        call.reject("Store policy conflict", "StorePolicyConflict"); return
                    }
                } else {
                    try Data(backup.utf8).write(to: policy, options: .atomic)
                }
                let root = backup == "eligible" ? eligible : backup == "excluded" ? excluded : cache
                let storeRoot = try self.confined(root, "stores/" + identity)
                try self.directory(storeRoot, excluded: backup != "eligible")
                if !path.isEmpty { _ = try self.confined(storeRoot, path) }
                call.resolve(["relativePath": "stores/" + identity + (path.isEmpty ? "" : "/" + path)])
            } catch StorageFailure.invalid {
                call.reject("Invalid storage input", "InvalidStorageInput")
            } catch {
                call.reject("Storage operation failed", "StorageIOFailed")
            }
        }
    }
}
