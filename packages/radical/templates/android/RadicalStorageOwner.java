/**
 * One synchronous owner for ALL Radical mutations of app-storage roots.
 *
 * Android API 24 has no public openat/mkdirat API. O_NOFOLLOW on an absolute
 * pathname does not protect its parents. Safety instead requires exclusive
 * mutation ownership from validation through use. Future key-value, secure
 * storage, SQLite, file, rename and deletion operations MUST use mutate().
 * No Radical storage API may create symlinks or return writable native paths.
 *
 * This is confinement against bridged callers, not a sandbox for arbitrary
 * native code sharing the app uid. Such code must join this owner; an app that
 * changes these private roots behind the owner violates the storage contract.
 * Namespaces are data partitions, not authorization boundaries against JS.
 */
public final class RadicalStorageOwner {
    private static final Object MONITOR = new Object();

    private RadicalStorageOwner() {}

    public static void mutate(Runnable operation) {
        synchronized (MONITOR) {
            operation.run();
        }
    }

    public static void requireMutation() {
        if (!Thread.holdsLock(MONITOR)) {
            throw new IllegalStateException("Storage access requires the mutation owner");
        }
    }
}
