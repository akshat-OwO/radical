import Darwin
import Foundation

/// Shared by the host test and the instrumented example app on the simulator.
/// All assertions use Foundation resource values, never raw attribute bytes.
enum StorageBackupChecks {
    struct Result {
        let checks: [String: Bool]
        let flags: [String: Bool]
    }
    private final class Trace {
        var events: [String] = []
        var failed = false
    }

    private static func flag(_ url: URL) throws -> Bool {
        let fresh = URL(fileURLWithPath: url.path)
        guard let value = try fresh.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup else {
            throw RadicalStorageBackup.Failure.io
        }
        return value
    }

    private static func opened(_ url: URL, directory: Bool = false) throws -> Int32 {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | (directory ? O_DIRECTORY : 0))
        guard fd >= 0 else { throw RadicalStorageBackup.Failure.io }
        return fd
    }

    static func run(installedRoots: Bool = false) throws -> Result {
        let manager = FileManager.default
        let sandbox = try RadicalStorageOwner.withMutation {
            let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let result = support.appendingPathComponent("radical-backup-test-" + UUID().uuidString)
            try manager.createDirectory(at: result, withIntermediateDirectories: false)
            return result
        }
        defer { RadicalStorageOwner.withMutation { try! manager.removeItem(at: sandbox) } }
        let trace = Trace()
        let serializedOutside = sandbox.appendingPathComponent("serialized-outside")
        var result = try RadicalStorageOwner.withMutation { () throws -> Result in
            var checks: [String: Bool] = [:]
            var flags: [String: Bool] = [:]
            let eligible = sandbox.appendingPathComponent("eligible")
            let excluded = sandbox.appendingPathComponent("excluded")
            try manager.createDirectory(at: eligible, withIntermediateDirectories: false)
            try manager.createDirectory(at: excluded, withIntermediateDirectories: false)
            let eligibleFD = try opened(eligible, directory: true)
            defer { close(eligibleFD) }
            let excludedFD = try opened(excluded, directory: true)
            defer { close(excludedFD) }
            try RadicalStorageBackup.apply(to: eligibleFD, at: eligible, excluded: false)
            try RadicalStorageBackup.apply(to: excludedFD, at: excluded, excluded: true)
            flags["eligible-root"] = try flag(eligible)
            flags["excluded-root"] = try flag(excluded)
            checks["eligible-root"] = flags["eligible-root"] == false
            checks["excluded-root"] = flags["excluded-root"] == true

            // Use an eligible parent so inheritance cannot make these pass.
            let newFile = eligible.appendingPathComponent("new")
            try Data("new".utf8).write(to: newFile)
            let newFD = try opened(newFile)
            defer { close(newFD) }
            try RadicalStorageBackup.apply(to: newFD, at: newFile, excluded: true)
            flags["new-file"] = try flag(newFile)
            checks["new-file"] = flags["new-file"] == true

            let staged = eligible.appendingPathComponent("stage")
            try Data("replacement".utf8).write(to: staged)
            let stagedFD = try opened(staged)
            defer { close(stagedFD) }
            try RadicalStorageBackup.apply(to: stagedFD, at: staged, excluded: true)
            flags["staged-file"] = try flag(staged)
            checks["staged-file"] = flags["staged-file"] == true
            // Simulate a save that drops the property. The replacement helper
            // must reapply it AFTER rename, not rely on staging or inheritance.
            try RadicalStorageBackup.apply(to: stagedFD, at: staged, excluded: false)
            flags["stage-before-replace"] = try flag(staged)
            checks["replacement-starts-unexcluded"] = flags["stage-before-replace"] == false
            let destination = eligible.appendingPathComponent("destination")
            try Data("old".utf8).write(to: destination)
            let oldFD = try opened(destination)
            defer { close(oldFD) }
            try RadicalStorageBackup.apply(to: oldFD, at: destination, excluded: true)
            try RadicalStorageBackup.replace(staged: "stage", destination: "destination", directory: eligibleFD, at: eligible, excluded: true)
            flags["replaced-file"] = try flag(destination)
            checks["replaced-file"] = flags["replaced-file"] == true
            checks["replacement-content"] = try Data(contentsOf: destination) == Data("replacement".utf8)
            var oldStat = stat()
            var newStat = stat()
            checks["replacement-is-new-inode"] = fstat(oldFD, &oldStat) == 0 && lstat(destination.path, &newStat) == 0 && oldStat.st_ino != newStat.st_ino

            let parent = sandbox.appendingPathComponent("parent")
            let target = parent.appendingPathComponent("target")
            let outside = sandbox.appendingPathComponent("outside")
            let outsideTarget = outside.appendingPathComponent("target")
            try manager.createDirectory(at: target, withIntermediateDirectories: true)
            try manager.createDirectory(at: outsideTarget, withIntermediateDirectories: true)
            let fd = try opened(target, directory: true)
            defer { close(fd) }
            let before = try flag(outsideTarget)
            try manager.moveItem(at: parent, to: sandbox.appendingPathComponent("moved"))
            try manager.createSymbolicLink(at: parent, withDestinationURL: outside)
            for excludedValue in [true, false] {
                var rejected = false
                do {
                    try RadicalStorageBackup.apply(to: fd, at: target, excluded: excludedValue)
                } catch RadicalStorageBackup.Failure.identityChanged { rejected = true }
                checks[excludedValue ? "parent-swap-set-rejected" : "parent-swap-clear-rejected"] = rejected
            }
            checks["outside-unchanged"] = try flag(outsideTarget) == before

            // A final-component symlink and a different regular-file inode
            // must both fail the same path/descriptor identity check.
            let leaf = eligible.appendingPathComponent("leaf")
            try Data().write(to: leaf)
            let leafFD = try opened(leaf)
            defer { close(leafFD) }
            try manager.removeItem(at: leaf)
            try manager.createSymbolicLink(at: leaf, withDestinationURL: newFile)
            var rejected = false
            do { try RadicalStorageBackup.apply(to: leafFD, at: leaf, excluded: true) }
            catch RadicalStorageBackup.Failure.identityChanged { rejected = true }
            checks["leaf-symlink-rejected"] = rejected
            try manager.removeItem(at: leaf)
            try Data().write(to: leaf)
            rejected = false
            do { try RadicalStorageBackup.apply(to: leafFD, at: leaf, excluded: true) }
            catch RadicalStorageBackup.Failure.identityChanged { rejected = true }
            checks["different-inode-rejected"] = rejected
            checks["different-inode-unchanged"] = try flag(leaf) == false
            rejected = false
            do { try RadicalStorageBackup.apply(to: -1, at: leaf, excluded: true) }
            catch RadicalStorageBackup.Failure.io { rejected = true }
            checks["invalid-descriptor-typed"] = rejected

            // The competing owned task is queued in the exact validation/use
            // interval. It cannot execute until the Foundation write completes.
            let serializedParent = sandbox.appendingPathComponent("serialized-parent")
            let serializedTarget = serializedParent.appendingPathComponent("target")
            try manager.createDirectory(at: serializedTarget, withIntermediateDirectories: true)
            try manager.createDirectory(at: serializedOutside.appendingPathComponent("target"), withIntermediateDirectories: true)
            let serializedFD = try opened(serializedTarget, directory: true)
            defer { close(serializedFD) }
            try RadicalStorageBackup.verify(serializedFD, at: serializedTarget)
            trace.events.append("validate")
            RadicalStorageOwner.enqueue {
                do {
                    try RadicalStorageOwner.requireMutation()
                    try manager.moveItem(at: serializedParent, to: sandbox.appendingPathComponent("serialized-moved"))
                    try manager.createSymbolicLink(at: serializedParent, withDestinationURL: serializedOutside)
                    trace.events.append("swap")
                } catch { trace.failed = true }
            }
            try RadicalStorageBackup.apply(to: serializedFD, at: serializedTarget, excluded: true)
            trace.events.append("apply")
            checks["serialized-write-completed"] = try flag(serializedTarget)

            if installedRoots {
                let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
                let caches = try manager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
                for (name, url, expected) in [
                    ("installed-eligible", support.appendingPathComponent("radical-storage/eligible"), false),
                    ("installed-excluded", support.appendingPathComponent("radical-storage/excluded"), true),
                    ("installed-cache", caches.appendingPathComponent("radical-storage"), true)
                ] {
                    flags[name] = try flag(url)
                    checks[name] = flags[name] == expected
                }
            }
            return Result(checks: checks, flags: flags)
        }
        // FIFO barrier: the queued competing task has now run.
        result = try RadicalStorageOwner.withMutation {
            var checks = result.checks
            checks["serialized-parent-swap"] = !trace.failed && trace.events == ["validate", "apply", "swap"]
            checks["serialized-outside-unchanged"] = try flag(serializedOutside.appendingPathComponent("target")) == false
            return Result(checks: checks, flags: result.flags)
        }
        var unownedRejected = false
        do { try RadicalStorageBackup.apply(to: -1, at: sandbox, excluded: true) }
        catch RadicalStorageOwner.Failure.unowned { unownedRejected = true }
        var checks = result.checks
        checks["unowned-access-rejected"] = unownedRejected
        return Result(checks: checks, flags: result.flags)
    }
}
