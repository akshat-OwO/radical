import Capacitor
import Darwin
import Foundation

@objc(RadicalAppStoragePlugin)
public class RadicalAppStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalAppStoragePlugin"
    public let jsName = "RadicalAppStorage"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "resolve", returnType: CAPPluginReturnPromise)]
    private static let queue = DispatchQueue(label: "radical.app-storage")
    private let classes = ["eligible", "excluded", "cache"]
    private enum StorageFailure: Error { case invalid, io, conflict }
    private struct Directory {
        let fd: Int32
        let url: URL
    }

    private func validName(_ value: String) -> Bool {
        value.range(of: "^[a-z0-9][a-z0-9_-]{0,127}$", options: .regularExpression) != nil
    }

    // Every access remains anchored to an open directory. O_NOFOLLOW rejects
    // dangling links as well as links to existing files, without a check/use gap.
    private func walk(_ base: Directory, _ components: [String], create: Bool, excluded: Bool) throws -> Directory? {
        var fd = dup(base.fd)
        guard fd >= 0 else { throw StorageFailure.io }
        var url = base.url
        do {
            for part in components {
                url.appendPathComponent(part)
                var next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                if next < 0 && errno == ENOENT && create {
                    guard mkdirat(fd, part, 0o700) == 0 || errno == EEXIST else { throw StorageFailure.io }
                    next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                    guard fsync(fd) == 0 else {
                        if next >= 0 { close(next) }
                        throw StorageFailure.io
                    }
                }
                if next < 0 {
                    let code = errno
                    var info = stat()
                    if fstatat(fd, part, &info, AT_SYMLINK_NOFOLLOW) == 0 && (info.st_mode & S_IFMT) == S_IFLNK {
                        throw StorageFailure.invalid
                    }
                    if code == ENOENT && !create { close(fd); return nil }
                    throw StorageFailure.io
                }
                close(fd)
                fd = next
                if create {
                    var target = url
                    var values = URLResourceValues()
                    values.isExcludedFromBackup = excluded
                    try target.setResourceValues(values)
                }
            }
            return Directory(fd: fd, url: url)
        } catch {
            close(fd)
            throw error
        }
    }

    private func root(_ base: URL, _ components: [String], excluded: Bool) throws -> Directory {
        let fd = open(base.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard fd >= 0 else { throw StorageFailure.io }
        defer { close(fd) }
        guard let result = try walk(Directory(fd: fd, url: base), components, create: true, excluded: false) else {
            throw StorageFailure.io
        }
        var target = result.url
        var values = URLResourceValues()
        values.isExcludedFromBackup = excluded
        do { try target.setResourceValues(values) } catch { close(result.fd); throw error }
        return result
    }

    private func policy(_ root: Directory, _ identity: [String]) throws -> String? {
        guard let parent = try walk(root, ["policies"] + Array(identity.dropLast()), create: false, excluded: false) else { return nil }
        defer { close(parent.fd) }
        let fd = openat(parent.fd, identity.last!, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        if fd < 0 {
            if errno == ENOENT { return nil }
            if errno == ELOOP { throw StorageFailure.invalid }
            throw StorageFailure.io
        }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size <= 8 else { throw StorageFailure.io }
        var bytes = [UInt8](repeating: 0, count: 9)
        var size = 0
        while size < bytes.count {
            let count = bytes.withUnsafeMutableBytes { buffer in
                Darwin.read(fd, buffer.baseAddress!.advanced(by: size), buffer.count - size)
            }
            guard count >= 0 else { throw StorageFailure.io }
            if count == 0 { break }
            size += count
        }
        let value = String(decoding: bytes.prefix(size), as: UTF8.self)
        guard classes.contains(value) else { throw StorageFailure.io }
        return value
    }

    private func publish(_ root: Directory, _ identity: [String], _ backup: String) throws {
        guard let parent = try walk(root, ["policies"] + Array(identity.dropLast()), create: true, excluded: backup != "eligible") else {
            throw StorageFailure.io
        }
        defer { close(parent.fd) }
        let temporary = ".policy-" + UUID().uuidString
        let fd = openat(parent.fd, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw StorageFailure.io }
        defer { close(fd); unlinkat(parent.fd, temporary, 0) }
        let bytes = Array(backup.utf8)
        var offset = 0
        while offset < bytes.count {
            let count = bytes.withUnsafeBytes { buffer in
                Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            }
            guard count > 0 else { throw StorageFailure.io }
            offset += count
        }
        guard fsync(fd) == 0 else { throw StorageFailure.io }
        if linkat(parent.fd, temporary, parent.fd, identity.last!, 0) != 0 {
            guard errno == EEXIST, try policy(root, identity) == backup else { throw StorageFailure.io }
        }
        guard fsync(parent.fd) == 0 else { throw StorageFailure.io }
    }

    private func validatePath(_ root: Directory, _ path: String) throws {
        let parts = path.split(separator: "/").map(String.init)
        guard !parts.isEmpty else { return }
        guard let parent = try walk(root, Array(parts.dropLast()), create: false, excluded: false) else { return }
        defer { close(parent.fd) }
        var info = stat()
        if fstatat(parent.fd, parts.last!, &info, AT_SYMLINK_NOFOLLOW) == 0 {
            if (info.st_mode & S_IFMT) == S_IFLNK { throw StorageFailure.invalid }
        } else if errno != ENOENT {
            throw StorageFailure.io
        }
    }

    @objc public func resolve(_ call: CAPPluginCall) {
        Self.queue.async {
            guard let capability = call.getString("capability"),
                  ["keyValue", "secureStorage", "sqlite", "fileSystem"].contains(capability),
                  let store = call.getString("store"), self.validName(store),
                  let namespace = call.getString("namespace"), self.validName(namespace),
                  let backup = call.getString("backup"), self.classes.contains(backup),
                  let path = call.getString("path"),
                  path.isEmpty || path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({
                      !$0.isEmpty && $0 != "." && $0 != ".." && $0.range(of: "[\\\\:\\x00-\\x1f]", options: .regularExpression) == nil
                  }) else { call.reject("Invalid storage input", "InvalidStorageInput"); return }
            do {
                let fm = FileManager.default
                let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let caches = try fm.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let eligible = try self.root(support, ["radical-storage", "eligible"], excluded: false)
                defer { close(eligible.fd) }
                let excluded = try self.root(support, ["radical-storage", "excluded"], excluded: true)
                defer { close(excluded.fd) }
                let cache = try self.root(caches, ["radical-storage"], excluded: true)
                defer { close(cache.fd) }
                // A process-wide queue and an on-disk advisory lock coordinate
                // directory creation and exclusive policy publication.
                let lock = openat(excluded.fd, ".policy.lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
                guard lock >= 0 else {
                    if errno == ELOOP { throw StorageFailure.invalid }
                    throw StorageFailure.io
                }
                defer { close(lock) }
                guard flock(lock, LOCK_EX) == 0 else { throw StorageFailure.io }
                defer { flock(lock, LOCK_UN) }
                let identity = [capability, store, namespace]
                let roots = [eligible, excluded, cache]
                for (index, root) in roots.enumerated() {
                    if let existing = try self.walk(root, ["stores"] + identity, create: false, excluded: false) {
                        close(existing.fd)
                        if self.classes[index] != backup { throw StorageFailure.conflict }
                    }
                }
                for root in [eligible, excluded] {
                    if let recorded = try self.policy(root, identity), recorded != backup { throw StorageFailure.conflict }
                }
                let index = self.classes.firstIndex(of: backup)!
                guard let storeRoot = try self.walk(roots[index], ["stores"] + identity, create: true, excluded: backup != "eligible") else {
                    throw StorageFailure.io
                }
                defer { close(storeRoot.fd) }
                try self.validatePath(storeRoot, path)
                let metadataRoot = backup == "eligible" ? eligible : excluded
                if try self.policy(metadataRoot, identity) == nil { try self.publish(metadataRoot, identity, backup) }
                call.resolve(["relativePath": "stores/" + identity.joined(separator: "/") + (path.isEmpty ? "" : "/" + path)])
            } catch StorageFailure.invalid {
                call.reject("Invalid storage input", "InvalidStorageInput")
            } catch StorageFailure.conflict {
                call.reject("Store policy conflict", "StorePolicyConflict")
            } catch {
                call.reject("Storage operation failed", "StorageIOFailed")
            }
        }
    }
}
