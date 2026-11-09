            if key.hasPrefix("__fixture_") {
                if key == "__fixture_crash" { _exit(0) }
                func fixtureSQL(_ db: OpaquePointer?, _ sql: String) throws {
                    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw Failure.io }
                }
                if key == "__fixture_seed" {
                    var seed: OpaquePointer?
                    guard sqlite3_open(database.path, &seed) == SQLITE_OK, let seed else { throw Failure.io }
                    try fixtureSQL(seed, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE radical_kv(namespace TEXT,key TEXT,json TEXT,PRIMARY KEY(namespace,key))")
                    var insert: OpaquePointer?
                    guard sqlite3_prepare_v2(seed, "INSERT INTO radical_kv VALUES(?,?,?)", -1, &insert, nil) == SQLITE_OK else { throw Failure.io }
                    for (i,value) in [call.getString("namespace")!, "key", "1"].enumerated() {
                        try RadicalKeyValueSQLite.bindText(value, to: insert, at: Int32(i + 1))
                    }
                    guard sqlite3_step(insert) == SQLITE_DONE else { throw Failure.io }
                    sqlite3_finalize(insert)
                    let large = call.getString("walFixture")?.hasPrefix("large") == true
                    // Large fixtures: 600 single-page rows. Same-size updates after the
                    // checkpoint put about 2.5 MB in the WAL without rewriting page 1.
                    if large {
                        let namespace = call.getString("namespace")!.replacingOccurrences(of: "'", with: "''")
                        try fixtureSQL(seed, "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<599) INSERT INTO radical_kv SELECT '" + namespace + "', 'row' || i, '\"' || printf('%.2998c', 'a') || '\"' FROM n")
                    }
                    try fixtureSQL(seed, "PRAGMA wal_checkpoint(TRUNCATE)")
                    if large {
                        try fixtureSQL(seed, "PRAGMA wal_autocheckpoint=0; UPDATE radical_kv SET json='\"' || printf('%.2998c', 'b') || '\"' WHERE key LIKE 'row%'")
                    }
                    if call.getString("walFixture") == "nonempty" { try fixtureSQL(seed, "UPDATE radical_kv SET json=2") }
                    if call.getString("walFixture") == "clean" {
                        // Healthy store without sidecars, as after a clean close or a restore.
                        guard sqlite3_close(seed) == SQLITE_OK else { throw Failure.io }
                        for suffix in ["-wal", "-shm"] where FileManager.default.fileExists(atPath: database.path + suffix) {
                            try FileManager.default.removeItem(atPath: database.path + suffix)
                        }
                        call.resolve([:])
                        return
                    }
                    radicalWalSeeds.append(seed)
                    call.resolve([:])
                    return
                }
                if key == "__fixture_mid" {
                    guard let cached = RadicalKeyValueConnections.entries[identity] else { throw Failure.io }
                    let db = cached.database
                    try fixtureSQL(db, "CREATE TABLE wal_marker(value TEXT); INSERT INTO wal_marker VALUES('one'); PRAGMA wal_checkpoint(TRUNCATE)")
                    var settings: [String: Int] = [:]
                    for pragma in ["synchronous", "wal_autocheckpoint", "page_size"] {
                        var statement: OpaquePointer?
                        guard sqlite3_prepare_v2(db, "PRAGMA " + pragma, -1, &statement, nil) == SQLITE_OK, sqlite3_step(statement) == SQLITE_ROW else { throw Failure.io }
                        settings[pragma] = Int(sqlite3_column_int(statement, 0))
                        sqlite3_finalize(statement)
                    }
                    let pageSize = settings.removeValue(forKey: "page_size")!
                    radicalSettings[identity] = settings
                    var statement: OpaquePointer?
                    guard sqlite3_prepare_v2(db, "SELECT rootpage FROM sqlite_master WHERE tbl_name='radical_kv' AND rootpage>0", -1, &statement, nil) == SQLITE_OK else { throw Failure.io }
                    var offsets: [UInt64] = []
                    while sqlite3_step(statement) == SQLITE_ROW {
                        offsets.append(UInt64(sqlite3_column_int(statement, 0) - 1) * UInt64(pageSize))
                    }
                    sqlite3_finalize(statement)
                    var other: OpaquePointer?
                    guard sqlite3_open(database.path, &other) == SQLITE_OK else { throw Failure.io }
                    try fixtureSQL(other, "PRAGMA synchronous=FULL; UPDATE wal_marker SET value='two'")
                    guard sqlite3_close(other) == SQLITE_OK else { throw Failure.io }
                    let file = try FileHandle(forWritingTo: database)
                    for offset in offsets {
                        try file.seek(toOffset: offset); try file.write(contentsOf: Data([255]))
                    }
                    try file.synchronize(); try file.close()
                }
                if key == "__fixture_damage" {
                    let file = try FileHandle(forWritingTo: database)
                    try file.seek(toOffset: 100); try file.write(contentsOf: Data([255])); try file.synchronize(); try file.close()
                    let wal = URL(fileURLWithPath: database.path + "-wal")
                    if call.getString("walFixture") == "orphan-shm", FileManager.default.fileExists(atPath: wal.path) {
                        try FileManager.default.removeItem(at: wal)
                    }
                }
                var files: [String: Any] = [:]
                for (name,suffix) in [("database",""),("wal","-wal"),("shm","-shm"),("journal","-journal")] {
                    let url = URL(fileURLWithPath: database.path + suffix)
                    var state: [String: Any] = ["exists": FileManager.default.fileExists(atPath: url.path)]
                    if FileManager.default.fileExists(atPath: url.path) {
                        let data = try Data(contentsOf: url)
                        state["bytes"] = data.count
                        state["sha256"] = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                    }
                    files[name] = state
                }
                let cached = RadicalKeyValueConnections.entries[identity]
                var result: [String: Any] = ["files": files, "preflights": radicalPreflights[database.path, default: 0],
                    "operations": radicalOperations[identity, default: 0], "quarantined": cached?.quarantined == true,
                    "handleRetained": cached?.database != nil]
                if let settings = radicalSettings[identity] { result["settings"] = settings }
                call.resolve(result)
                return
            }
