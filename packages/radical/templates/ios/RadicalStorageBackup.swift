import Darwin
import Foundation

/// Foundation's supported backup API needs a pathname. The shared mutation
/// owner prevents other Radical tasks changing that path between validation
/// and use. Bind both sides of the Foundation call to the verified inode too.
/// Arbitrary same-uid native writers outside the owner are not sandboxed here.
enum RadicalStorageBackup {
    enum Failure: Error { case io, identityChanged }

    static func verify(_ descriptor: Int32, at url: URL) throws {
        try RadicalStorageOwner.requireMutation()
        var opened = stat()
        guard fstat(descriptor, &opened) == 0 else { throw Failure.io }
        var named = stat()
        guard lstat(url.path, &named) == 0 else {
            if errno == ENOENT || errno == ENOTDIR || errno == ELOOP { throw Failure.identityChanged }
            throw Failure.io
        }
        guard (named.st_mode & S_IFMT) != S_IFLNK,
              named.st_dev == opened.st_dev, named.st_ino == opened.st_ino else {
            throw Failure.identityChanged
        }
    }

    static func apply(to descriptor: Int32, at url: URL, excluded: Bool) throws {
        try verify(descriptor, at: url)
        var values = URLResourceValues()
        values.isExcludedFromBackup = excluded
        // A fresh URL avoids reusing cached resource values after a save.
        var target = URL(fileURLWithPath: url.path)
        do { try target.setResourceValues(values) } catch { throw Failure.io }
        try verify(descriptor, at: url)
    }

    /// Stage and destination are leaf names in the same verified directory.
    /// The caller applies policy after each staging save. Always reapply it
    /// after rename as Apple does not guarantee saves preserve the property.
    static func replace(staged: String, destination: String, directory: Int32, at parent: URL, excluded: Bool) throws {
        try RadicalStorageOwner.requireMutation()
        guard [staged, destination].allSatisfy({
            !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("/") && !$0.contains("\0")
        }), staged != destination else { throw Failure.identityChanged }
        try verify(directory, at: parent)
        let fd = openat(directory, staged, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else {
            if errno == ELOOP { throw Failure.identityChanged }
            throw Failure.io
        }
        defer { close(fd) }
        try verify(fd, at: parent.appendingPathComponent(staged))
        guard renameat(directory, staged, directory, destination) == 0 else { throw Failure.io }
        try verify(directory, at: parent)
        try apply(to: fd, at: parent.appendingPathComponent(destination), excluded: excluded)
        guard fsync(fd) == 0, fsync(directory) == 0 else { throw Failure.io }
    }
}
