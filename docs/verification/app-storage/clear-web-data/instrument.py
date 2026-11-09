"""Instrument only generated example code to seed/read verification state."""
from pathlib import Path
import sys

repo = Path(__file__).resolve().parents[4]
platform = sys.argv[1]
if platform == "android":
    project, = (repo / "apps/example/.radical/android/android/app/src/main/java").rglob("EchoPlugin.java")
    anchor = '        String text = call.getString("text", "");'
    branch = """
        if (text.equals("storage-clear-seed") || text.equals("storage-clear-check")) {
            RadicalStorageOwner.mutate(() -> {
                try {
                    android.content.SharedPreferences prefs = getContext().getSharedPreferences("radical.notificationTopics", android.content.Context.MODE_PRIVATE);
                    java.io.File sentinel = new java.io.File(getContext().getCacheDir(), "radical-storage/stores/fileSystem/verify-202/cache/sentinel");
                    if (text.equals("storage-clear-seed")) {
                        if (!prefs.edit().putStringSet("topics", new java.util.HashSet<>(java.util.Arrays.asList("verification-topic"))).commit()) throw new java.io.IOException();
                        try (java.io.FileOutputStream output = new java.io.FileOutputStream(sentinel)) {
                            output.write("cache-survives".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                            output.getFD().sync();
                        }
                    }
                    boolean contentsMatch = false;
                    if (sentinel.isFile()) {
                        try (java.io.FileInputStream input = new java.io.FileInputStream(sentinel)) {
                            byte[] bytes = new byte[32];
                            int count = input.read(bytes);
                            contentsMatch = count == 14 && new String(bytes, 0, count, java.nio.charset.StandardCharsets.UTF_8).equals("cache-survives");
                        }
                    }
                    JSObject probe = new JSObject();
                    probe.put("topicRecordEmpty", prefs.getAll().isEmpty());
                    probe.put("cacheSurvives", contentsMatch);
                    probe.put("cacheRootPresent", new java.io.File(getContext().getCacheDir(), "radical-storage").isDirectory());
                    JSObject envelope = new JSObject();
                    envelope.put("text", probe.toString());
                    call.resolve(envelope);
                } catch (Exception error) { call.reject("Verification failed", "StorageIOFailed"); }
            });
            return;
        }
"""
elif platform == "ios":
    project = repo / "apps/example/.radical/ios/ios/App/App/AppDelegate.swift"
    anchor = '        let text = call.getString("text") ?? ""'
    branch = """
        if text == "storage-clear-seed" || text == "storage-clear-check" {
            do {
                let result = try RadicalStorageOwner.withMutation { () throws -> [String: Bool] in
                    let manager = FileManager.default
                    let caches = try manager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
                    let root = caches.appendingPathComponent("radical-storage")
                    let sentinel = root.appendingPathComponent("stores/fileSystem/verify-202/cache/sentinel")
                    if text == "storage-clear-seed" {
                        UserDefaults.standard.set(["verification-topic"], forKey: "radical.notificationTopics")
                        try Data("cache-survives".utf8).write(to: sentinel)
                    }
                    let contents = try? Data(contentsOf: sentinel)
                    return [
                        "topicRecordEmpty": UserDefaults.standard.object(forKey: "radical.notificationTopics") == nil,
                        "cacheSurvives": contents == Data("cache-survives".utf8),
                        "cacheRootPresent": manager.fileExists(atPath: root.path)
                    ]
                }
                let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                call.resolve(["text": String(decoding: data, as: UTF8.self)])
            } catch { call.reject("Verification failed", "StorageIOFailed") }
            return
        }
"""
else:
    raise SystemExit("Expected android or ios")
original = project.with_suffix(".production")
source = project.read_text()
if original.exists() or source.count(anchor) != 1:
    raise SystemExit("Regenerate before instrumenting")
original.write_text(source)
project.write_text(source.replace(anchor, anchor + branch))
