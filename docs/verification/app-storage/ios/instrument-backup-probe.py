"""Add a test-only Echo branch to a generated example, never product sources."""
from pathlib import Path

repo = Path(__file__).resolve().parents[4]
project = repo / "apps/example/.radical/ios/ios/App/App/AppDelegate.swift"
original = project.with_suffix(".production")
if original.exists():
    raise SystemExit("Production backup already exists; regenerate before instrumenting")
source = project.read_text()
anchor = '        let text = call.getString("text") ?? ""'
if source.count(anchor) != 1 or "enum StorageBackupChecks" in source:
    raise SystemExit("Unexpected generated example source")
branch = '''
        if text == "storage-backup-probe" {
            do {
                let result = try StorageBackupChecks.run(installedRoots: true)
                let data = try JSONSerialization.data(withJSONObject: ["checks": result.checks, "flags": result.flags], options: [.prettyPrinted, .sortedKeys])
                call.resolve(["text": String(decoding: data, as: UTF8.self)])
            } catch {
                call.reject("Storage backup verification failed", "StorageIOFailed")
            }
            return
        }
'''
checks = (repo / "packages/radical/tests/native-behavior/StorageBackupChecks.swift").read_text()
original.write_text(source)
project.write_text(source.replace(anchor, anchor + branch) + "\n" + checks)
