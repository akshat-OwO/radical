"""Add test-only corruption fixtures to generated shells, never product sources."""
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
android = repo / "apps/example/.radical/android/android/app/src/main/java/dev/radical/example/android/RadicalKeyValuePlugin.java"
ios = repo / "apps/example/.radical/ios/ios/App/App/AppDelegate.swift"
for path in (android, ios):
    if path.with_suffix(".production").exists():
        raise SystemExit("Regenerate before instrumenting again")
    path.with_suffix(".production").write_text(path.read_text())

source = android.read_text()
anchor = '            try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase'
assert source.count(anchor) == 1
fixture = r'''
            // Test-only filesystem fixture. The resolver holds the shared mutation owner.
            if (key.startsWith("__fixture_")) {
                File database = new File(root, "key-value.sqlite");
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
                java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
                try (java.io.FileInputStream input = new java.io.FileInputStream(database)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                StringBuilder hex = new StringBuilder();
                for (byte value : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                JSObject result = new JSObject();
                result.put("sha256", hex.toString());
                result.put("bytes", database.length());
                call.resolve(result);
                return;
            }
'''
source = source.replace(anchor, fixture + anchor)
anchor = 'new Object[]{namespace,key,json}'
assert source.count(anchor) == 1
source = source.replace(anchor, r'new Object[]{namespace,key,key.equals("recover") && org.json.JSONObject.quote("fixture-corrupt-row").equals(json) ? "{broken" : json}')
android.write_text(source)

source = ios.read_text()
source = 'import CryptoKit\n' + source
anchor = '            try sidecars()\n            // CREATE'
assert source.count(anchor) == 1
fixture = r'''
            // Test-only filesystem fixture. The resolver holds the shared mutation owner.
            if key.hasPrefix("__fixture_") {
                if key == "__fixture_header" || key == "__fixture_btree" {
                    let file = try FileHandle(forWritingTo: database)
                    defer { try? file.close() }
                    try file.seek(toOffset: key == "__fixture_header" ? 0 : 100)
                    try file.write(contentsOf: key == "__fixture_header" ? Data("not-a-database!!".utf8) : Data([255]))
                    try file.synchronize()
                }
                let data = try Data(contentsOf: database)
                let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                call.resolve(["sha256": digest, "bytes": data.count])
                return
            }
'''
source = source.replace(anchor, fixture + anchor)
anchor = '            if operation == "set" { values.append(call.getString("json")!) }'
assert source.count(anchor) == 1
source = source.replace(anchor, r'''            if operation == "set" { values.append(key == "recover" && call.getString("json") == "\"fixture-corrupt-row\"" ? "{broken" : call.getString("json")!) }''')
ios.write_text(source)
