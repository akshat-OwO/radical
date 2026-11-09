"""Run the production Swift preflight/cache/quarantine against crash-left files."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[4]
owned = repo / "apps/example/.radical/kv-final"
owned.mkdir(parents=True, exist_ok=True)
binary = owned / "host-wal-test"
subprocess.run([
    "swiftc",
    str(repo / "packages/radical/templates/ios/RadicalStorageOwner.swift"),
    str(repo / "packages/radical/templates/ios/RadicalKeyValueSQLite.swift"),
    str(repo / "packages/radical/templates/ios/RadicalKeyValueConnection.swift"),
    str(repo / "packages/radical/tests/native-behavior/KeyValueWALTest.swift"),
    "-o", str(binary)
], check=True)

def snapshot(database):
    result = {}
    for name, suffix in (("database", ""), ("wal", "-wal"), ("shm", "-shm"), ("journal", "-journal")):
        path = Path(str(database) + suffix)
        state = {"exists": path.exists()}
        if path.exists():
            data = path.read_bytes()
            state.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        result[name] = state
    return result

def preserved(before, after):
    wal = before["wal"] == after["wal"] or (
        not before["wal"]["exists"] and after["wal"].get("bytes") == 0
    )
    return before["database"] == after["database"] and wal

results = []
with tempfile.TemporaryDirectory(dir=owned) as directory:
    for scenario in ("nonempty", "empty", "orphan-shm", "mid", "clean", "large", "large-healthy"):
        for operation in (("get",) if scenario == "large-healthy" else ("get", "set", "clear")):
            database = Path(directory) / (scenario + "-" + operation + ".sqlite")
            if scenario != "mid":
                subprocess.run([str(binary), "seed", str(database), scenario], check=True)
            report = json.loads(subprocess.check_output([
                str(binary), "mid" if scenario == "mid" else "check",
                str(database), scenario, operation
            ], text=True))
            exited = snapshot(database)
            if scenario == "large-healthy":
                # Healthy maintenance: every committed row stays readable.
                passes = not report["failed"] and report["committedRows"] == 600 and report["before"]["wal"]["bytes"] >= 1048576
                results.append(dict(scenario=scenario, operation=operation, **report, afterExit=exited, passed=passes))
                continue
            if scenario == "large":
                assert report["before"]["wal"]["bytes"] >= 1048576
            if scenario == "clean":
                # A healthy WAL-mode store without -wal or -shm must still open.
                passes = not report["failed"] and not report["before"]["wal"]["exists"]
                results.append(dict(scenario=scenario, operation=operation, **report, afterExit=exited, passed=passes))
                continue
            passes = report["failed"] and report["laterCallsRefused"]
            for state in (report["after"], report["afterLaterCalls"], exited):
                passes = passes and preserved(report["before"], state)
            if scenario == "mid":
                passes = passes and report["sameCachedEntry"] and report["quarantined"] and report["handleRetained"]
                passes = passes and report["settings"]["synchronous"] == 2 and report["settings"]["wal_autocheckpoint"] > 0
            # SHM changes and WAL creation are recorded, never asserted.
            changed = [name for name in exited if report["before"][name] != exited[name]]
            results.append(dict(scenario=scenario, operation=operation, **report, afterExit=exited, changedAfterExit=changed, passed=passes))
output = {"results": results}
(repo / "docs/verification/key-value/host-wal.json").write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps({"cases": len(results), "passed": sum(row["passed"] for row in results)}))
assert all(row["passed"] for row in results), "Main database/WAL preservation failed"
