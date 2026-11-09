"""Instrument generated shells for crash-left WAL and cached quarantine regressions."""
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
here = Path(__file__).parent
android = repo / "apps/example/.radical/android/android/app/src/main/java/dev/radical/example/android/RadicalKeyValuePlugin.java"
ios = repo / "apps/example/.radical/ios/ios/App/App/AppDelegate.swift"
def replace(source, old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new)

for path in (android, ios):
    if path.with_suffix(".production").exists():
        raise SystemExit("Regenerate before instrumenting again")
    path.with_suffix(".production").write_text(path.read_text())

source = android.read_text()
source = replace(source, "public class RadicalKeyValuePlugin extends RadicalAppStoragePlugin {", """public class RadicalKeyValuePlugin extends RadicalAppStoragePlugin {
    private static final java.util.List<SQLiteDatabase> WAL_SEEDS = new java.util.ArrayList<>();
    private static final java.util.Map<String, Integer> PREFLIGHTS = new java.util.HashMap<>();
    private static final java.util.Map<String, Integer> OPERATIONS = new java.util.HashMap<>();
    private static final java.util.Map<String, JSObject> SETTINGS = new java.util.HashMap<>();
""")
source = replace(source, "    private static void preflight(File database) throws ErrnoException, java.io.IOException {", """    private static void preflight(File database) throws ErrnoException, java.io.IOException {
        PREFLIGHTS.put(database.getPath(), PREFLIGHTS.getOrDefault(database.getPath(), 0) + 1);""")
source = replace(source, "resolveStore(call, () -> requireUsable(identity), root -> {", 'resolveStore(call, () -> { if (!key.startsWith("__fixture_")) requireUsable(identity); }, root -> {')
anchor = '            StoreConnection state = connection(identity, new File(root, "key-value.sqlite"));'
assert source.count(anchor) == 1
source = replace(source, anchor, (here / "wal-android.java").read_text() + "\n" + anchor)
source = replace(source, '''            SQLiteDatabase db = state.database;
            try {''', '''            SQLiteDatabase db = state.database;
            OPERATIONS.put(identity(call), OPERATIONS.getOrDefault(identity(call), 0) + 1);
            try {''')
android.write_text(source)

source = ios.read_text()
source = """import CryptoKit
private var radicalWalSeeds: [OpaquePointer] = []
private var radicalPreflights: [String: Int] = [:]
private var radicalOperations: [String: Int] = [:]
private var radicalSettings: [String: [String: Int]] = [:]
""" + source
source = replace(source, "private static var entries:", "static var entries:")
source = replace(source, "    private static func preflight(_ url: URL) throws {", """    private static func preflight(_ url: URL) throws {
        radicalPreflights[url.path, default: 0] += 1""")
source = replace(source, "            try RadicalKeyValueConnections.requireUsable(identity)", '            if !key.hasPrefix("__fixture_") { try RadicalKeyValueConnections.requireUsable(identity) }')
anchor = "            let entry: RadicalKeyValueConnections.Entry\n"
assert source.count(anchor) == 1
source = replace(source, anchor, (here / "wal-ios.swift").read_text() + "\n" + anchor)
source = replace(source, "            let db = entry.database", """            let db = entry.database
            radicalOperations[identity, default: 0] += 1""")
ios.write_text(source)
