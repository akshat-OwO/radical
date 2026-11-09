import Darwin
import Foundation

/// The on-disk marker used by URLResourceValues.isExcludedFromBackup.
/// Write it through the verified descriptor: resolving a URL here would reopen
/// the parent-symlink race after openat has already confined directory access.
enum RadicalStorageBackup {
    enum Failure: Error { case io }

    static func apply(to descriptor: Int32, excluded: Bool) throws {
        let attribute = "com.apple.metadata:com_apple_backup_excludeItem"
        if excluded {
            let marker = Array("com.apple.MobileBackup".utf8)
            let result = marker.withUnsafeBytes { bytes in
                fsetxattr(descriptor, attribute, bytes.baseAddress, bytes.count, 0, 0)
            }
            guard result == 0 else { throw Failure.io }
        } else {
            guard fremovexattr(descriptor, attribute, 0) == 0 || errno == ENOATTR else {
                throw Failure.io
            }
        }
    }
}
