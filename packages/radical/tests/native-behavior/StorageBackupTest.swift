import Darwin
import Foundation

@main
struct StorageBackupTest {
    static func marker(_ url: URL) -> Data? {
        var bytes = [UInt8](repeating: 0, count: 256)
        let count = getxattr(url.path, "com.apple.metadata:com_apple_backup_excludeItem", &bytes, bytes.count, 0, 0)
        if count < 0 {
            precondition(errno == ENOATTR)
            return nil
        }
        return Data(bytes.prefix(count))
    }

    static func main() throws {
        let manager = FileManager.default
        let sandbox = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try manager.createDirectory(at: sandbox, withIntermediateDirectories: false)
        defer { try! manager.removeItem(at: sandbox) }
        let parent = sandbox.appendingPathComponent("parent")
        let verified = parent.appendingPathComponent("target")
        let moved = sandbox.appendingPathComponent("moved")
        let outside = sandbox.appendingPathComponent("outside")
        try manager.createDirectory(at: verified, withIntermediateDirectories: true)
        try manager.createDirectory(at: outside.appendingPathComponent("target"), withIntermediateDirectories: true)
        let outsideTarget = outside.appendingPathComponent("target")
        let fd = open(verified.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        precondition(fd >= 0)
        defer { close(fd) }

        // Replace the parent AFTER verification/open, BEFORE the attribute write.
        // A pathname-based implementation would now modify outside/target.
        try manager.moveItem(at: parent, to: moved)
        try manager.createSymbolicLink(at: parent, withDestinationURL: outside)
        let before = marker(outsideTarget)
        try RadicalStorageBackup.apply(to: fd, excluded: true)
        precondition(marker(outsideTarget) == before)
        precondition(marker(moved.appendingPathComponent("target")) == Data("com.apple.MobileBackup".utf8))

        // Clearing the flag must use the same descriptor even through a hostile path.
        try RadicalStorageBackup.apply(to: fd, excluded: false)
        precondition(marker(outsideTarget) == before)
        precondition(marker(moved.appendingPathComponent("target")) == nil)
        do {
            try RadicalStorageBackup.apply(to: -1, excluded: true)
            preconditionFailure("Invalid descriptor accepted")
        } catch RadicalStorageBackup.Failure.io {
            // Failed descriptor operations remain typed native failures.
        }
        print("PASS: replacing the parent cannot redirect either backup-attribute mutation")
    }
}
