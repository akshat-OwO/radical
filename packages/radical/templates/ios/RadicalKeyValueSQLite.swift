import Foundation
import SQLite3

/// Length-delimited SQLite text preserves embedded NUL and owns no connection.
enum RadicalKeyValueSQLite {
    enum Failure: Error { case io }

    static func bindText(_ value: String, to statement: OpaquePointer?, at index: Int32) throws {
        let bytes = Array(value.utf8)
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        let status: Int32
        if bytes.isEmpty {
            // SQLite treats a nil pointer as SQL NULL even when the byte count is zero.
            status = sqlite3_bind_text(statement, index, "", 0, transient)
        } else {
            status = bytes.withUnsafeBufferPointer { buffer in
                // A nonempty array supplies a valid pointer for its exact byte count.
                let pointer = UnsafeRawPointer(buffer.baseAddress!).assumingMemoryBound(to: CChar.self)
                return sqlite3_bind_text(statement, index, pointer, Int32(buffer.count), transient)
            }
        }
        guard status == SQLITE_OK else { throw Failure.io }
    }

    static func text(from statement: OpaquePointer?, at column: Int32) throws -> String {
        // Request UTF-8 first; count the bytes of that same representation.
        guard let bytes = sqlite3_column_text(statement, column) else { throw Failure.io }
        let count = Int(sqlite3_column_bytes(statement, column))
        guard let value = String(bytes: UnsafeBufferPointer(start: bytes, count: count), encoding: .utf8) else { throw Failure.io }
        return value
    }
}
