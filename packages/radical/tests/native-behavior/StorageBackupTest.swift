import Foundation

@main
struct StorageBackupTest {
    static func main() throws {
        let result = try StorageBackupChecks.run()
        let data = try JSONSerialization.data(withJSONObject: ["checks": result.checks, "flags": result.flags], options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        precondition(result.checks.values.allSatisfy { $0 }, "Backup/confinement checks failed")
    }
}
