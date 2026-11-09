"""Instrument generated shells only. Regenerate before repeating."""
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
android = repo / "apps/example/.radical/android/android/app/src/main/java/dev/radical/example/android/RadicalKeyValuePlugin.java"
ios = repo / "apps/example/.radical/ios/ios/App/App/AppDelegate.swift"

source = android.read_text()
anchor = '                String namespace = call.getString("namespace");'
source = source.replace(anchor, anchor + '''
                // Test fixture: bypass JSON validation only after opening under the shared owner.
                if (operation.equals("set") && key.equals("corrupt")) {
                    db.execSQL("INSERT OR REPLACE INTO radical_kv(namespace,key,json) VALUES(?,?,?)", new Object[]{namespace,key,"{broken"});
                    call.resolve(new JSObject()); return;
                }
''')
source = source.replace('                call.resolve(result);', '''
                JSObject proof = new JSObject();
                String rootPath = root.getCanonicalPath();
                String rootClass = rootPath.startsWith(getContext().getNoBackupFilesDir().getCanonicalPath() + "/") ? "excluded" :
                    rootPath.startsWith(getContext().getCacheDir().getCanonicalPath() + "/") ? "cache" : "eligible";
                proof.put("rootClass", rootClass);
                proof.put("files", new JSArray(java.util.Arrays.asList(root.list())));
                result.put("verification", proof);
                call.resolve(result);''')
android.with_suffix(".production").write_text(android.read_text())
android.write_text(source)

source = ios.read_text()
anchor = '            if operation == "set" { values.append(call.getString("json")!) }'
source = source.replace(anchor, '            if operation == "set" { values.append(key == "corrupt" ? "{broken" : call.getString("json")!) }')
anchor = '            try sidecars()\n            call.resolve(result)'
source = source.replace(anchor, '''
            try sidecars()
            let files = try FileManager.default.contentsOfDirectory(atPath: root.path).sorted()
            var flags: [String: Bool] = [:]
            for name in files {
                let url = root.appendingPathComponent(name)
                guard let flag = try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup else { throw Failure.io }
                flags[name] = flag
            }
            let rootClass = root.path.contains("/Caches/") ? "cache" : root.path.contains("/radical-storage/excluded/") ? "excluded" : "eligible"
            result["verification"] = ["rootClass": rootClass, "files": files, "excluded": flags] as [String: Any]
            call.resolve(result)''')
ios.with_suffix(".production").write_text(ios.read_text())
ios.write_text(source)
