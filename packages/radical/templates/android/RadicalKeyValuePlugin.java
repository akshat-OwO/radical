import android.database.Cursor;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.JsonReader;
import android.util.JsonToken;
import java.io.StringReader;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileDescriptor;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "RadicalKeyValue")
public class RadicalKeyValuePlugin extends RadicalAppStoragePlugin {
    // Android's default handler deletes corrupt databases. Abort instead, including
    // during open, so the framework cannot retry by silently creating an empty store.
    private static final DatabaseErrorHandler PRESERVE_CORRUPT_DATABASE = database -> {
        throw new SQLiteDatabaseCorruptException("Key-value database is corrupt");
    };

    /**
     * One writable connection per store identity, cached for the process lifetime.
     *
     * When the last writable connection to a WAL database closes, SQLite checkpoints
     * WAL frames into the main database and truncates or deletes the WAL. On a
     * corrupt store that would rewrite files after a failure. Radical therefore
     * never closes a writable connection it opened:
     *
     * - Before the first writable open in a process, a read-only preflight reads the
     *   schema and the first radical_kv row. A read-only connection cannot checkpoint,
     *   so closing it on corruption leaves the main database and WAL unchanged. SQLite
     *   may rebuild the volatile SHM index or create an empty WAL; neither holds data.
     * - If a cached writer reports corruption mid-operation, its identity is
     *   quarantined: the handle stays referenced here, no statement ever runs on it
     *   again, and every later call fails with StorageIOFailed without touching the
     *   store files. The OS releases the handle at process exit without a SQLite
     *   close, so no checkpoint runs. The next launch's preflight reports the
     *   corruption again.
     *
     * The preflight is not an integrity_check, which reads every page. A database
     * that passes it is treated as healthy, so normal maintenance applies: the
     * platform's writable open checkpoints and truncates a WAL at or above
     * db_wal_truncate_size (1 MiB on AOSP), and commits run automatic checkpoints.
     * Both move committed frames into the database and lose no data.
     *
     * Every access to this map runs inside RadicalStorageOwner.
     */
    private static final class StoreConnection {
        SQLiteDatabase database; // null when the read-only preflight found corruption
        boolean initialized;
        boolean quarantined;
    }

    private static final java.util.Map<String, StoreConnection> CONNECTIONS = new java.util.HashMap<>();

    // Matches the foundation identity: one database per keyValue store and namespace.
    private static String identity(PluginCall call) {
        return call.getString("store") + "/" + call.getString("namespace");
    }

    private static void requireUsable(String identity) {
        RadicalStorageOwner.requireMutation();
        StoreConnection state = CONNECTIONS.get(identity);
        if (state != null && state.quarantined) throw new IllegalStateException("Store quarantined");
    }

    // SQLite opens a WAL database read-only only when its -wal file exists or can be
    // created, and not every SQLite build creates it for a read-only connection. A
    // WAL-mode database without a -wal file is valid, for example after a clean close
    // or a restore. Create the empty WAL that a writable open would create. An empty
    // WAL holds no frames, so no data changes.
    private static void ensureWal(File database) throws ErrnoException, java.io.IOException {
        FileDescriptor input = Os.open(database.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);
        int mode;
        byte[] version = new byte[1];
        try {
            mode = Os.fstat(input).st_mode & 0777;
            // Header byte 18 is the file format write version; 2 means WAL mode.
            if (Os.pread(input, version, 0, 1, 18) != 1 || version[0] != 2) return;
        } finally { Os.close(input); }
        try {
            Os.close(Os.open(database.getPath() + "-wal",
                    OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL | OsConstants.O_NOFOLLOW, mode));
        } catch (ErrnoException error) {
            if (error.errno != OsConstants.EEXIST) throw error;
        }
    }

    // Reads the schema and one radical_kv row, not an O(database size) integrity scan.
    // The check runs once per database per process because the writer is cached.
    private static void preflight(File database) throws ErrnoException, java.io.IOException {
        if (!database.exists()) return;
        ensureWal(database);
        try (SQLiteDatabase probe = SQLiteDatabase.openDatabase(database.getPath(), null,
                SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS, PRESERVE_CORRUPT_DATABASE)) {
            boolean table;
            try (Cursor schema = probe.rawQuery("SELECT 1 FROM sqlite_master WHERE type=? AND name=? LIMIT 1",
                    new String[]{"table", "radical_kv"})) {
                table = schema.moveToFirst();
            }
            if (table) {
                try (Cursor row = probe.rawQuery("SELECT namespace,key,json FROM radical_kv LIMIT 1", null)) {
                    row.moveToFirst();
                }
            }
        }
    }

    private static StoreConnection connection(String identity, File database) throws ErrnoException, java.io.IOException {
        requireUsable(identity);
        StoreConnection state = CONNECTIONS.get(identity);
        if (state == null) {
            state = new StoreConnection();
            try {
                preflight(database);
                state.database = SQLiteDatabase.openDatabase(database.getPath(), null,
                        SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY |
                        SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                        PRESERVE_CORRUPT_DATABASE);
            } catch (SQLiteDatabaseCorruptException error) {
                // No writer exists. Refuse the identity until the process exits.
                state.quarantined = true;
                CONNECTIONS.put(identity, state);
                throw error;
            }
            // Other failures cache nothing, so a later call runs the preflight again.
            CONNECTIONS.put(identity, state);
        }
        if (!state.initialized) {
            try {
                // FULL makes every committed set, remove, or clear durable in the WAL.
                // SQLite's automatic checkpoint, configured by the platform, bounds the WAL.
                state.database.execSQL("PRAGMA synchronous=FULL");
                state.database.execSQL("CREATE TABLE IF NOT EXISTS radical_kv (namespace TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(namespace, key))");
            } catch (SQLiteDatabaseCorruptException error) {
                state.quarantined = true;
                throw error;
            }
            // Other failures keep the open writer and retry these idempotent statements.
            state.initialized = true;
        }
        return state;
    }

    @PluginMethod public void execute(PluginCall call) {
        if (!"keyValue".equals(call.getString("capability")) || !"".equals(call.getString("path"))) {
            call.reject("Invalid storage input", "InvalidStorageInput", new JSObject()); return;
        }
        String operation = call.getString("operation");
        String key = call.getString("key");
        String json = call.getString("json");
        if (operation == null || !java.util.Arrays.asList("get", "set", "remove", "clear").contains(operation) || key == null || key.length() > 1024 || (!operation.equals("clear") && key.isEmpty()) ||
            (operation.equals("set") && (json == null || json.getBytes(StandardCharsets.UTF_8).length > 1048576))) {
            call.reject("Invalid storage input", "InvalidStorageInput", new JSObject()); return;
        }
        if (operation.equals("set")) {
            // Wrapping permits JSON scalars while JsonReader remains strict.
            try (JsonReader reader = new JsonReader(new StringReader("[" + json + "]"))) {
                reader.setLenient(false);
                reader.beginArray();
                if (!reader.hasNext()) throw new IllegalArgumentException();
                reader.skipValue();
                if (reader.hasNext()) throw new IllegalArgumentException();
                reader.endArray();
                if (reader.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException();
            } catch (Exception error) {
                call.reject("Invalid storage input", "InvalidStorageInput", new JSObject()); return;
            }
        }
        String identity = identity(call);
        // Refuse a quarantined identity before the foundation resolves any path.
        resolveStore(call, () -> requireUsable(identity), root -> {
            for (String suffix : new String[]{"", "-wal", "-shm", "-journal"}) {
                File file = new File(root, "key-value.sqlite" + suffix);
                try { if (!OsConstants.S_ISREG(Os.lstat(file.getPath()).st_mode)) throw new SecurityException(); }
                catch (android.system.ErrnoException error) { if (error.errno != OsConstants.ENOENT) throw error; }
            }
            StoreConnection state = connection(identity, new File(root, "key-value.sqlite"));
            SQLiteDatabase db = state.database;
            try {
                String namespace = call.getString("namespace");
                JSObject result = new JSObject();
                if (operation.equals("get")) {
                    try (Cursor cursor = db.rawQuery("SELECT json FROM radical_kv WHERE namespace=? AND key=?", new String[]{namespace, key})) {
                        if (cursor.moveToFirst()) result.put("json", cursor.getString(0));
                    }
                } else {
                    // Each mutation is one atomic SQLite statement. No explicit
                    // transaction rollback is issued after a corruption exception.
                    if (operation.equals("set")) db.execSQL("INSERT OR REPLACE INTO radical_kv(namespace,key,json) VALUES(?,?,?)", new Object[]{namespace,key,json});
                    else if (operation.equals("remove")) db.execSQL("DELETE FROM radical_kv WHERE namespace=? AND key=?", new Object[]{namespace,key});
                    else db.execSQL("DELETE FROM radical_kv WHERE namespace=?", new Object[]{namespace});
                }
                call.resolve(result);
            } catch (SQLiteDatabaseCorruptException error) {
                // Do not close: that could checkpoint into the corrupt database or WAL.
                state.quarantined = true;
                throw error;
            }
        });
    }
}
