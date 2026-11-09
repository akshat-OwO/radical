import Foundation

/// All Radical app-storage mutations in the shell process, including background
/// jobs and file replacement, run synchronously within this shared owner.
/// No Radical API creates symlinks. Native code or another process modifying
/// these private roots behind the owner is outside the storage contract.
/// Namespaces partition data; they do not authorize bridged JavaScript.
enum RadicalStorageOwner {
    enum Failure: Error { case unowned }
    private static let key = DispatchSpecificKey<Bool>()
    private static let queue: DispatchQueue = {
        let result = DispatchQueue(label: "radical.app-storage.owner")
        result.setSpecific(key: key, value: true)
        return result
    }()

    static func withMutation<A>(_ operation: () throws -> A) rethrows -> A {
        _ = queue
        if DispatchQueue.getSpecific(key: key) == true { return try operation() }
        return try queue.sync(execute: operation)
    }

    static func enqueue(_ operation: @escaping () -> Void) {
        queue.async(execute: DispatchWorkItem(block: operation))
    }

    static func requireMutation() throws {
        _ = queue
        guard DispatchQueue.getSpecific(key: key) == true else { throw Failure.unowned }
    }
}
