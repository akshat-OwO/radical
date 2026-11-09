import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.system.Os;
import android.system.OsConstants;
import android.util.JsonReader;
import android.util.JsonToken;
import java.io.StringReader;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "RadicalKeyValue")
public class RadicalKeyValuePlugin extends RadicalAppStoragePlugin {
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
        resolveStore(call, root -> {
            for (String suffix : new String[]{"", "-wal", "-shm", "-journal"}) {
                File file = new File(root, "key-value.sqlite" + suffix);
                try { if (!OsConstants.S_ISREG(Os.lstat(file.getPath()).st_mode)) throw new SecurityException(); }
                catch (android.system.ErrnoException error) { if (error.errno != OsConstants.ENOENT) throw error; }
            }
            try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(new File(root, "key-value.sqlite"), null)) {
                db.enableWriteAheadLogging();
                db.execSQL("CREATE TABLE IF NOT EXISTS radical_kv (namespace TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(namespace, key))");
                String namespace = call.getString("namespace");
                JSObject result = new JSObject();
                if (operation.equals("get")) {
                    try (Cursor cursor = db.rawQuery("SELECT json FROM radical_kv WHERE namespace=? AND key=?", new String[]{namespace, key})) {
                        if (cursor.moveToFirst()) result.put("json", cursor.getString(0));
                    }
                } else {
                    db.beginTransaction();
                    try {
                        if (operation.equals("set")) db.execSQL("INSERT OR REPLACE INTO radical_kv(namespace,key,json) VALUES(?,?,?)", new Object[]{namespace,key,json});
                        else if (operation.equals("remove")) db.execSQL("DELETE FROM radical_kv WHERE namespace=? AND key=?", new Object[]{namespace,key});
                        else db.execSQL("DELETE FROM radical_kv WHERE namespace=?", new Object[]{namespace});
                        db.setTransactionSuccessful();
                    } finally { db.endTransaction(); }
                }
                call.resolve(result);
            }
        });
    }
}
