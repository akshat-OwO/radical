import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@CapacitorPlugin(name = "RadicalAppStorage")
public class RadicalAppStoragePlugin extends Plugin {
    private static final Object POLICY_LOCK = new Object();
    private static final String[] CLASSES = {"eligible", "excluded", "cache"};

    private static final class Descriptor implements AutoCloseable {
        final FileDescriptor fd;
        Descriptor(String path, int flags, int mode) throws ErrnoException { fd = Os.open(path, flags, mode); }
        public void close() throws ErrnoException { Os.close(fd); }
    }

    private static boolean name(String value) {
        return value != null && value.matches("[a-z0-9][a-z0-9_-]{0,127}");
    }

    // lstat never follows a link, including a link whose destination is missing.
    private static StructStat inspect(File file) throws ErrnoException {
        try {
            StructStat stat = Os.lstat(file.getPath());
            if (OsConstants.S_ISLNK(stat.st_mode)) throw new SecurityException();
            return stat;
        } catch (ErrnoException error) {
            if (error.errno == OsConstants.ENOENT) return null;
            throw error;
        }
    }

    private static File confined(File root, String relative) throws IOException, ErrnoException {
        File current = root;
        inspect(current);
        for (String part : relative.split("/")) {
            current = new File(current, part);
            inspect(current);
        }
        if (!current.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) {
            throw new SecurityException();
        }
        return current;
    }

    private static void directory(File file) throws IOException, ErrnoException {
        StructStat stat = inspect(file);
        if (stat == null) {
            File parent = file.getParentFile();
            if (parent != null) directory(parent);
            if (!file.mkdir() && inspect(file) == null) throw new IOException();
            syncDirectory(parent);
            stat = inspect(file);
        }
        if (stat == null || !OsConstants.S_ISDIR(stat.st_mode)) throw new IOException();
    }

    private static void syncDirectory(File directory) throws IOException, ErrnoException {
        java.io.FileDescriptor fd = Os.open(directory.getPath(),
            OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);
        try {
            if (!OsConstants.S_ISDIR(Os.fstat(fd).st_mode)) throw new IOException();
            Os.fsync(fd);
        } finally { Os.close(fd); }
    }

    private static String readPolicy(File file) throws IOException, ErrnoException {
        StructStat stat = inspect(file);
        if (stat == null) return null;
        if (OsConstants.S_ISDIR(stat.st_mode)) {
            file = confined(file, "policy");
            stat = inspect(file);
        }
        if (stat == null || !OsConstants.S_ISREG(stat.st_mode) || stat.st_size > 8) throw new IOException();
        try (Descriptor input = new Descriptor(file.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW | OsConstants.O_NONBLOCK, 0)) {
            if (!OsConstants.S_ISREG(Os.fstat(input.fd).st_mode)) throw new IOException();
            byte[] bytes = new byte[9];
            int size = 0;
            int count;
            while (size < bytes.length && (count = Os.read(input.fd, bytes, size, bytes.length - size)) > 0) size += count;
            String value = new String(bytes, 0, size, StandardCharsets.UTF_8);
            if (!java.util.Arrays.asList(CLASSES).contains(value)) throw new IOException();
            return value;
        }
    }

    // The target is never visible until the complete, flushed record exists.
    // A nonempty policy directory cannot be replaced by rename. Publication is
    // exclusive, and the shared file lock also coordinates it with store creation.
    private static void publishPolicy(File target, String backup) throws IOException, ErrnoException {
        File parent = target.getParentFile();
        directory(parent);
        File temporary = new File(parent, ".policy-" + UUID.randomUUID());
        if (!temporary.mkdir()) throw new IOException();
        File contents = new File(temporary, "policy");
        try {
            try (Descriptor output = new Descriptor(contents.getPath(),
                    OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL | OsConstants.O_NOFOLLOW, 0600)) {
                byte[] bytes = backup.getBytes(StandardCharsets.UTF_8);
                int offset = 0;
                while (offset < bytes.length) {
                    int count = Os.write(output.fd, bytes, offset, bytes.length - offset);
                    if (count <= 0) throw new IOException();
                    offset += count;
                }
                Os.fsync(output.fd);
            }
            syncDirectory(temporary);
            try {
                Os.rename(temporary.getPath(), target.getPath());
            } catch (ErrnoException error) {
                if (error.errno != OsConstants.EEXIST && error.errno != OsConstants.ENOTEMPTY && error.errno != OsConstants.ENOTDIR) throw error;
                if (!backup.equals(readPolicy(target))) throw new IOException();
            }
            syncDirectory(parent);
        } finally {
            if (inspect(temporary) != null) {
                if (!contents.delete() && inspect(contents) != null) throw new IOException();
                if (!temporary.delete() && inspect(temporary) != null) throw new IOException();
            }
        }
    }

    @PluginMethod public void resolve(PluginCall call) {
        String capability = call.getString("capability");
        String store = call.getString("store");
        String namespace = call.getString("namespace");
        String backup = call.getString("backup");
        String path = call.getString("path");
        if (!name(store) || !name(namespace) || capability == null ||
            !java.util.Arrays.asList("keyValue", "secureStorage", "sqlite", "fileSystem").contains(capability) ||
            !java.util.Arrays.asList(CLASSES).contains(backup) || path == null ||
            (!path.isEmpty() && java.util.Arrays.stream(path.split("/", -1)).anyMatch(p ->
                p.isEmpty() || p.equals(".") || p.equals("..") || p.matches(".*[\\\\:\\x00-\\x1f].*")))) {
            call.reject("Invalid storage input", "InvalidStorageInput"); return;
        }
        synchronized (POLICY_LOCK) {
            try {
                File[] roots = {
                    new File(getContext().getFilesDir(), "radical-storage"),
                    new File(getContext().getNoBackupFilesDir(), "radical-storage"),
                    new File(getContext().getCacheDir(), "radical-storage")
                };
                for (File root : roots) directory(root);
                File lockFile = confined(roots[1], ".policy.lock");
                try (Descriptor descriptor = new Descriptor(lockFile.getPath(), OsConstants.O_RDWR | OsConstants.O_CREAT | OsConstants.O_NOFOLLOW, 0600);
                     FileOutputStream lockStream = new FileOutputStream(descriptor.fd);
                     FileLock lock = lockStream.getChannel().lock()) {
                    String identity = capability + "/" + store + "/" + namespace;
                    // Restore can bring back directories before metadata, or only eligible data.
                    // Consult every class before creating anything for this identity.
                    for (int i = 0; i < roots.length; i++) {
                        File existing = confined(roots[i], "stores/" + identity);
                        if (inspect(existing) != null && !CLASSES[i].equals(backup)) {
                            call.reject("Store policy conflict", "StorePolicyConflict"); return;
                        }
                    }
                    for (int i = 0; i < 2; i++) {
                        String recorded = readPolicy(confined(roots[i], "policies/" + identity));
                        if (recorded != null && !recorded.equals(backup)) {
                            call.reject("Store policy conflict", "StorePolicyConflict"); return;
                        }
                    }
                    int index = java.util.Arrays.asList(CLASSES).indexOf(backup);
                    File storeRoot = confined(roots[index], "stores/" + identity);
                    if (!path.isEmpty()) confined(storeRoot, path);
                    // An interruption after mkdir still leaves a class-identifying directory.
                    directory(storeRoot);
                    syncDirectory(storeRoot.getParentFile());
                    File policy = confined(roots[index == 0 ? 0 : 1], "policies/" + identity);
                    if (readPolicy(policy) == null) publishPolicy(policy, backup);
                    JSObject result = new JSObject();
                    result.put("relativePath", "stores/" + identity + (path.isEmpty() ? "" : "/" + path));
                    call.resolve(result);
                }
            } catch (SecurityException error) {
                call.reject("Invalid storage input", "InvalidStorageInput");
            } catch (IOException | ErrnoException | RuntimeException error) {
                call.reject("Storage operation failed", "StorageIOFailed");
            }
        }
    }
}
