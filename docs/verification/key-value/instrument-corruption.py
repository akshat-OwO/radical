"""Add test-only corruption fixtures to generated shells, never product sources."""
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
android = repo / "apps/example/.radical/android/android/app/src/main/java/dev/radical/example/android/RadicalKeyValuePlugin.java"
ios = repo / "apps/example/.radical/ios/ios/App/App/AppDelegate.swift"
for path in (android, ios):
    if path.with_suffix(".production").exists():
        raise SystemExit("Regenerate before instrumenting again")
    path.with_suffix(".production").write_text(path.read_text())

source = android.read_text().replace(
    'public class RadicalKeyValuePlugin extends RadicalAppStoragePlugin {',
    'public class RadicalKeyValuePlugin extends RadicalAppStoragePlugin {\n    private static final java.util.List<SQLiteDatabase> WAL_SEEDS = new java.util.ArrayList<>();'
)
anchor = '            try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase'
assert source.count(anchor) == 1
fixture = r'''
            // Test-only filesystem fixture. The resolver holds the shared mutation owner.
            if (key.startsWith("__fixture_")) {
                File database = new File(root, "key-value.sqlite");
                if (key.equals("__fixture_crash")) { Runtime.getRuntime().halt(0); }
                if (key.equals("__fixture_seed")) {
                    SQLiteDatabase seed = SQLiteDatabase.openOrCreateDatabase(database.getPath(), null, PRESERVE_CORRUPT_DATABASE);
                    seed.enableWriteAheadLogging();
                    seed.execSQL("PRAGMA synchronous=FULL");
                    seed.execSQL("CREATE TABLE radical_kv(namespace TEXT NOT NULL,key TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(namespace,key))");
                    seed.execSQL("INSERT INTO radical_kv VALUES(?,?,?)", new Object[]{call.getString("namespace"),"key",org.json.JSONObject.quote("one")});
                    try (Cursor checkpoint = seed.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) { while (checkpoint.moveToNext()) {} }
                    if ("nonempty".equals(call.getString("walFixture"))) seed.execSQL("UPDATE radical_kv SET json=? WHERE key=?", new Object[]{org.json.JSONObject.quote("two"),"key"});
                    WAL_SEEDS.add(seed);
                    JSObject result = new JSObject();
                    try (Cursor version = seed.rawQuery("SELECT sqlite_version()", null)) {
                        if (version.moveToFirst()) result.put("sqliteVersion", version.getString(0));
                    }
                    call.resolve(result);
                    return;
                }
                if (key.equals("__fixture_damage")) {
                    try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(database, "rw")) {
                        file.seek(100); file.writeByte(255); file.getFD().sync();
                    }
                    if ("orphan-shm".equals(call.getString("walFixture"))) {
                        java.io.File wal = new java.io.File(database.getPath() + "-wal");
                        if (wal.exists() && !wal.delete()) throw new java.io.IOException();
                    }
                }
                if (key.equals("__fixture_header") || key.equals("__fixture_btree")) {
                    try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(database, "rw")) {
                        if (key.equals("__fixture_header")) {
                            file.seek(0);
                            file.write("not-a-database!!".getBytes(StandardCharsets.UTF_8));
                        } else {
                            file.seek(100); // Invalid page-1 b-tree type with an intact SQLite header.
                            file.writeByte(255);
                        }
                        file.getFD().sync();
                    }
                }
                JSObject result = new JSObject();
                JSObject files = new JSObject();
                String[] suffixes = {"", "-wal", "-shm", "-journal"};
                String[] names = {"database", "wal", "shm", "journal"};
                for (int index = 0; index < suffixes.length; index++) {
                    File target = new File(database.getPath() + suffixes[index]);
                    JSObject state = new JSObject();
                    state.put("exists", target.exists());
                    if (target.exists()) {
                        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
                        try (java.io.FileInputStream input = new java.io.FileInputStream(target)) {
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                        }
                        StringBuilder hex = new StringBuilder();
                        for (byte value : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                        state.put("bytes", target.length()); state.put("sha256", hex.toString());
                        if (index == 0) { result.put("bytes", target.length()); result.put("sha256", hex.toString()); }
                    }
                    files.put(names[index], state);
                }
                result.put("files", files);
                call.resolve(result);
                return;
            }
'''
source = source.replace(anchor, fixture + anchor)
readonly = r'''
            if (call.getBoolean("readonlyProbe", false)) {
                try (SQLiteDatabase probe = SQLiteDatabase.openDatabase(new File(root, "key-value.sqlite").getPath(), null, SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS, PRESERVE_CORRUPT_DATABASE)) {
                    try (Cursor check = probe.rawQuery("PRAGMA integrity_check(1)", null)) {
                        if (!check.moveToFirst() || !"ok".equals(check.getString(0))) throw new SQLiteDatabaseCorruptException("Invalid database");
                    }
                }
            }
'''
source = source.replace(anchor, readonly + anchor)
anchor = 'new Object[]{namespace,key,json}'
assert source.count(anchor) == 1
source = source.replace(anchor, r'new Object[]{namespace,key,key.equals("recover") && org.json.JSONObject.quote("fixture-corrupt-row").equals(json) ? "{broken" : json}')
android.write_text(source)

source = ios.read_text()
source = 'import CryptoKit\nprivate var radicalWalSeeds: [OpaquePointer] = []\n' + source
anchor = '            try sidecars()\n            // CREATE'
assert source.count(anchor) == 1
fixture = r'''
            // Test-only filesystem fixture. The resolver holds the shared mutation owner.
            if key.hasPrefix("__fixture_") {
                if key == "__fixture_crash" { _exit(0) }
                if key == "__fixture_seed" {
                    var seed: OpaquePointer?
                    guard sqlite3_open(database.path, &seed) == SQLITE_OK, let seed else { throw Failure.io }
                    for sql in ["PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "CREATE TABLE radical_kv(namespace TEXT NOT NULL,key TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(namespace,key))"] {
                        guard sqlite3_exec(seed, sql, nil, nil, nil) == SQLITE_OK else { throw Failure.io }
                    }
                    var insert: OpaquePointer?
                    guard sqlite3_prepare_v2(seed, "INSERT INTO radical_kv VALUES(?,?,?)", -1, &insert, nil) == SQLITE_OK else { throw Failure.io }
                    for (i,value) in [call.getString("namespace")!, "key", String(decoding: try JSONSerialization.data(withJSONObject: "one", options: [.fragmentsAllowed]), as: UTF8.self)].enumerated() {
                        try RadicalKeyValueSQLite.bindText(value, to: insert, at: Int32(i + 1))
                    }
                    guard sqlite3_step(insert) == SQLITE_DONE else { throw Failure.io }
                    sqlite3_finalize(insert)
                    guard sqlite3_exec(seed, "PRAGMA wal_checkpoint(TRUNCATE)", nil, nil, nil) == SQLITE_OK else { throw Failure.io }
                    if call.getString("walFixture") == "nonempty" {
                        var update: OpaquePointer?
                        guard sqlite3_prepare_v2(seed, "UPDATE radical_kv SET json=? WHERE key=?", -1, &update, nil) == SQLITE_OK else { throw Failure.io }
                        try RadicalKeyValueSQLite.bindText(String(decoding: try JSONSerialization.data(withJSONObject: "two", options: [.fragmentsAllowed]), as: UTF8.self), to: update, at: 1)
                        try RadicalKeyValueSQLite.bindText("key", to: update, at: 2)
                        guard sqlite3_step(update) == SQLITE_DONE else { throw Failure.io }
                        sqlite3_finalize(update)
                    }
                    radicalWalSeeds.append(seed)
                    var enabled: Int32 = 0
                    var persistent: Int32 = 0
                    let noCheckpointRC = RadicalWalNoCheckpoint(UnsafeMutableRawPointer(seed), &enabled)
                    let persistRC = RadicalWalPersist(UnsafeMutableRawPointer(seed), &persistent)
                    call.resolve(["sqliteVersion": String(cString: sqlite3_libversion()), "noCheckpointRC": noCheckpointRC, "noCheckpoint": enabled, "persistRC": persistRC, "persist": persistent])
                    return
                }
                if key == "__fixture_damage" {
                    let file = try FileHandle(forWritingTo: database)
                    try file.seek(toOffset: 100); try file.write(contentsOf: Data([255])); try file.synchronize(); try file.close()
                    let wal = URL(fileURLWithPath: database.path + "-wal")
                    if call.getString("walFixture") == "orphan-shm", FileManager.default.fileExists(atPath: wal.path) { try FileManager.default.removeItem(at: wal) }
                }
                if key == "__fixture_header" || key == "__fixture_btree" {
                    let file = try FileHandle(forWritingTo: database)
                    defer { try? file.close() }
                    try file.seek(toOffset: key == "__fixture_header" ? 0 : 100)
                    try file.write(contentsOf: key == "__fixture_header" ? Data("not-a-database!!".utf8) : Data([255]))
                    try file.synchronize()
                }
                var result: [String: Any] = [:]
                var files: [String: Any] = [:]
                for (name,suffix) in [("database",""),("wal","-wal"),("shm","-shm"),("journal","-journal")] {
                    let url = URL(fileURLWithPath: database.path + suffix)
                    var state: [String: Any] = ["exists": FileManager.default.fileExists(atPath: url.path)]
                    if FileManager.default.fileExists(atPath: url.path) {
                        let data = try Data(contentsOf: url)
                        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                        state["bytes"] = data.count; state["sha256"] = digest
                        if name == "database" { result["bytes"] = data.count; result["sha256"] = digest }
                    }
                    files[name] = state
                }
                result["files"] = files
                call.resolve(result)
                return
            }
'''
source = source.replace(anchor, fixture + anchor)
readonly = r'''
            if call.getBool("readonlyProbe") == true {
                var probe: OpaquePointer?
                guard sqlite3_open_v2(database.path, &probe, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                    if probe != nil { sqlite3_close(probe) }; throw Failure.io
                }
                defer { sqlite3_close(probe) }
                guard sqlite3_exec(probe, "PRAGMA integrity_check(1)", nil, nil, nil) == SQLITE_OK else { throw Failure.io }
            }
'''
source = source.replace("            // CREATE initializes", readonly + "            // CREATE initializes")
controls = r'''
            if call.getBool("closeControls") == true {
                var noCheckpoint: Int32 = 0
                var persistent: Int32 = 0
                guard RadicalWalNoCheckpoint(UnsafeMutableRawPointer(db), &noCheckpoint) == SQLITE_OK, noCheckpoint == 1,
                      RadicalWalPersist(UnsafeMutableRawPointer(db), &persistent) == SQLITE_OK, persistent == 1 else { throw Failure.io }
                if call.getBool("exclusiveProbe") == true {
                    guard sqlite3_exec(db, "PRAGMA locking_mode=EXCLUSIVE", nil, nil, nil) == SQLITE_OK else { throw Failure.io }
                }
            }
'''
source = source.replace("            func sql(_ text:", controls + "            func sql(_ text:")
anchor = '            if operation == "set" { values.append(call.getString("json")!) }'
assert source.count(anchor) == 1
source = source.replace(anchor, r'''            if operation == "set" { values.append(key == "recover" && call.getString("json") == "\"fixture-corrupt-row\"" ? "{broken" : call.getString("json")!) }''')
ios.write_text(source)

# Test-only fixed-arity C bridge for SQLite's variadic sqlite3_db_config.
project = ios.parents[1] / "App.xcodeproj/project.pbxproj"
for name in ("wal-config.c", "wal-config.h"):
    (ios.parent / name).write_text((Path(__file__).parent / name).read_text())
text = project.read_text()
text = text.replace("/* End PBXBuildFile section */", "A20300000000000000000001 = {isa = PBXBuildFile; fileRef = A20300000000000000000002; };\n/* End PBXBuildFile section */")
text = text.replace("/* End PBXFileReference section */", "A20300000000000000000002 = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.c; path = App/wal-config.c; sourceTree = SOURCE_ROOT; };\n/* End PBXFileReference section */")
text = text.replace("504EC3081FED79650016851F /* AppDelegate.swift in Sources */,", "504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\nA20300000000000000000001,")
text = text.replace("SWIFT_VERSION = 5.0;", "SWIFT_VERSION = 5.0;\nSWIFT_OBJC_BRIDGING_HEADER = App/wal-config.h;")
project.write_text(text)
