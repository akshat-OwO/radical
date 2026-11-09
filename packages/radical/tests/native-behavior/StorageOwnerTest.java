import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

/** Deterministic in-memory parent-swap model against the production owner. */
public final class StorageOwnerTest {
    public static void main(String[] args) throws Exception {
        List<String> events = new ArrayList<>();
        AtomicReference<String> parent = new AtomicReference<>("root");
        List<String> created = new ArrayList<>();
        ThreadMXBean threads = ManagementFactory.getThreadMXBean();
        long owner = Thread.currentThread().getId();
        CountDownLatch attempted = new CountDownLatch(1);
        Thread swap = new Thread(() -> {
            attempted.countDown();
            RadicalStorageOwner.mutate(() -> {
                RadicalStorageOwner.requireMutation();
                parent.set("outside");
                events.add("swap");
            });
        });
        RadicalStorageOwner.mutate(() -> {
            RadicalStorageOwner.requireMutation();
            if (!parent.get().equals("root")) throw new AssertionError();
            events.add("validate");
            swap.start();
            try { attempted.await(); } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new AssertionError(error);
            }
            // Wait for the actual monitor attempt, not a scheduling delay.
            // No timeout, sleep, disk, or network participates in this test.
            boolean blockedByOwner = false;
            while (swap.isAlive()) {
                ThreadInfo info = threads.getThreadInfo(swap.getId());
                if (info != null && info.getThreadState() == Thread.State.BLOCKED && info.getLockOwnerId() == owner) {
                    blockedByOwner = true;
                    break;
                }
                Thread.yield();
            }
            if (!blockedByOwner) throw new AssertionError("Swap escaped the owner");
            created.add(parent.get() + "/namespace");
            events.add("use");
        });
        swap.join();
        if (!events.equals(java.util.Arrays.asList("validate", "use", "swap"))) throw new AssertionError(events);
        if (!created.equals(java.util.Arrays.asList("root/namespace"))) throw new AssertionError(created);
        try {
            RadicalStorageOwner.requireMutation();
            throw new AssertionError("Unowned access accepted");
        } catch (IllegalStateException expected) {
            // The private filesystem helpers use this guard too.
        }
        System.out.println("PASS: competing parent swap cannot run between validation and use");
    }
}
