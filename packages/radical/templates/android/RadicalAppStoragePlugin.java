import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

@CapacitorPlugin(name = "RadicalAppStorage")
public class RadicalAppStoragePlugin extends Plugin {
    private static boolean name(String value) {
        return value != null && value.matches("[a-z0-9][a-z0-9_-]{0,127}");
    }
    private static File confined(File root, String relative) throws IOException {
        File target = new File(root, relative);
        String base = root.getCanonicalPath();
        if (!target.getCanonicalPath().startsWith(base + File.separator)) {
            throw new SecurityException();
        }
        // Reject symlinks even when they point inside the root.
        File current = target;
        while (!current.equals(root)) {
            if (Files.isSymbolicLink(current.toPath())) throw new SecurityException();
            current = current.getParentFile();
        }
        return target;
    }
    @PluginMethod public synchronized void resolve(PluginCall call) {
        String capability = call.getString("capability");
        String store = call.getString("store");
        String namespace = call.getString("namespace");
        String backup = call.getString("backup");
        String path = call.getString("path");
        if (!name(store) || !name(namespace) || capability == null ||
            !java.util.Arrays.asList("keyValue", "secureStorage", "sqlite", "fileSystem").contains(capability) ||
            !java.util.Arrays.asList("eligible", "excluded", "cache").contains(backup) || path == null ||
            (!path.isEmpty() && java.util.Arrays.stream(path.split("/", -1)).anyMatch(p ->
                p.isEmpty() || p.equals(".") || p.equals("..") || p.matches(".*[\\\\:\\x00-\\x1f].*")))) {
            call.reject("Invalid storage input", "InvalidStorageInput"); return;
        }
        try {
            File eligible = new File(getContext().getFilesDir(), "radical-storage");
            File excluded = new File(getContext().getNoBackupFilesDir(), "radical-storage");
            File cache = new File(getContext().getCacheDir(), "radical-storage");
            for (File root : new File[]{eligible, excluded, cache}) {
                if (Files.isSymbolicLink(root.toPath())) throw new SecurityException();
                Files.createDirectories(root.toPath());
            }
            String identity = capability + "/" + store + "/" + namespace;
            File policyRoot = confined(excluded, "policies");
            Files.createDirectories(policyRoot.toPath());
            File policy = confined(policyRoot, identity);
            Files.createDirectories(policy.getParentFile().toPath());
            if (policy.exists()) {
                if (!Files.readString(policy.toPath()).equals(backup)) {
                    call.reject("Store policy conflict", "StorePolicyConflict"); return;
                }
            } else {
                Files.writeString(policy.toPath(), backup, StandardCharsets.UTF_8, java.nio.file.StandardOpenOption.CREATE_NEW);
            }
            File root = backup.equals("eligible") ? eligible : backup.equals("excluded") ? excluded : cache;
            File directory = confined(root, "stores/" + identity);
            Files.createDirectories(directory.toPath());
            if (!path.isEmpty()) confined(directory, path);
            JSObject result = new JSObject();
            result.put("relativePath", "stores/" + identity + (path.isEmpty() ? "" : "/" + path));
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Invalid storage input", "InvalidStorageInput");
        } catch (IOException error) {
            call.reject("Storage operation failed", "StorageIOFailed");
        }
    }
}
