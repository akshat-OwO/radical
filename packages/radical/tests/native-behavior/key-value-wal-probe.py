"""Record strict preservation failures; exit 1 if any observed file changes."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
import sys

repo = Path(__file__).resolve().parents[4]
owned = repo / "apps/example/.radical/wal-check"
owned.mkdir(parents=True, exist_ok=True)
binary = owned / "host-wal-probe"
subprocess.run([
    "clang", str(repo / "packages/radical/tests/native-behavior/KeyValueWALProbe.c"),
    str(repo / "docs/verification/key-value/wal-config.c"),
    "-I", str(repo / "docs/verification/key-value"), "-lsqlite3", "-o", str(binary)
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

results = []
with tempfile.TemporaryDirectory(dir=owned) as directory:
    for scenario in ("nonempty", "empty", "orphan-shm"):
        for mode in ("default", "readonly", "controls", "controls-exclusive"):
            for operation in ("get", "set", "clear"):
                database = Path(directory) / (scenario + "-" + mode + "-" + operation + ".sqlite")
                subprocess.run([str(binary), "seed", str(database), scenario], check=True)
                if scenario == "orphan-shm":
                    Path(str(database) + "-wal").unlink()
                with database.open("r+b") as file:
                    file.seek(100)
                    file.write(bytes([255]))
                before = snapshot(database)
                assert before["shm"]["exists"]
                if scenario == "nonempty": assert before["wal"]["bytes"] > 0
                if scenario == "empty": assert before["wal"]["bytes"] == 0
                native_mode = "ro" if mode == "readonly" else mode
                observed = json.loads(subprocess.check_output([str(binary), native_mode, str(database), operation], text=True))
                after = snapshot(database)
                changes = [name for name in before if before[name] != after[name]]
                results.append(dict(scenario=scenario, mode=mode, operation=operation, native=observed, before=before, after=after, changed=changes, preserved=not changes))
output = {"purpose": "Observation of rejected preservation candidates, not a passing production regression", "results": results}
destination = repo / "docs/verification/key-value/host-wal.json"
destination.write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps({"cases": len(results), "preserved": sum(row["preserved"] for row in results)}))
sys.exit(0 if all(row["preserved"] for row in results) else 1)
