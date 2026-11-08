import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import android.os.*;
import android.Manifest;
import com.getcapacitor.*;
import com.google.android.gms.location.*;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArraySet;

public class RadicalTrackingService extends Service {
    static JSObject snapshot;
    static PluginCall pendingStart;
    static JSObject previous;
    static RadicalTrackingService owner;
    static boolean stopping;
    static boolean stopRequested;
    static final java.util.ArrayList<PluginCall> pendingStops = new java.util.ArrayList<>();
    private static long revision;
    static final CopyOnWriteArraySet<Runnable> observers = new CopyOnWriteArraySet<>();
    private static boolean hydrated;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long timeoutMillis;
    private final Runnable timeout = () -> {
        if (!stopping && pendingStart == null && snapshot != null &&
            "running".equals(snapshot.getJSObject("status").getString("state"))) {
            snapshot.put("lastError", new JSObject().put("_tag", "LocationTimeout"));
            publish();
        }
    };
    private final BroadcastReceiver providers = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { reconcile(); }
    };
    private final PackageManager.OnPermissionsChangedListener permissions =
        uid -> { if (uid == android.os.Process.myUid()) handler.post(this::reconcile); };
    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private Runnable teardownComplete;
    private boolean removing;
    private boolean destroyed;
    private static final String CHANNEL = "radical_tracking";
    private static AtomicFile metadata(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "radical-tracking.json"));
    }
    static void persist(Context context) throws IOException {
        AtomicFile file = metadata(context);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            if (snapshot != null) {
                JSObject record = new JSObject();
                record.put("id", snapshot.getString("id"));
                record.put("options", snapshot.getJSObject("options"));
                record.put("startedAt", snapshot.optLong("startedAt"));
                String state = snapshot.getJSObject("status").getString("state");
                record.put("terminalState", "stopped".equals(state) || "interrupted".equals(state)
                    ? snapshot.getJSObject("status") : org.json.JSONObject.NULL);
                output.write(record.toString().getBytes(StandardCharsets.UTF_8));
            }
            file.finishWrite(output);
        } catch (IOException | RuntimeException error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }
    static void hydrate(Context context) {
        if (hydrated) return;
        hydrated = true;
        try {
            JSObject record = new JSObject(new String(metadata(context).readFully(), StandardCharsets.UTF_8));
            snapshot = new JSObject();
            snapshot.put("id", record.getString("id"));
            snapshot.put("options", record.getJSObject("options"));
            snapshot.put("startedAt", record.optLong("startedAt"));
            JSObject terminal = record.getJSObject("terminalState");
            snapshot.put("status", terminal == null
                ? new JSObject().put("state", "interrupted").put("reason", "termination") : terminal);
            snapshot.put("latest", org.json.JSONObject.NULL);
            snapshot.put("lastError", org.json.JSONObject.NULL);
            refreshPermissions(context);
            publish();
        } catch (FileNotFoundException ignored) {
            // No session has been acknowledged in this installation.
        } catch (Exception error) {
            android.util.Log.e("RadicalTracking", "Cannot read tracking metadata", error);
        }
    }
    static void refreshPermissions(Context context) {
        boolean granted = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        snapshot.put("permission", new JSObject().put("state", granted ? "granted" : "denied").put("precision",
            !granted ? "unknown" : context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ? "precise" : "approximate"));
        snapshot.put("notifications", new JSObject().put("state",
            Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED ? "granted" : "denied"));
    }
    private void armTimeout() {
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, timeoutMillis);
    }
    void reconcile() {
        if (destroyed || snapshot == null || pendingStart != null || stopping) return;
        String state = snapshot.getJSObject("status").getString("state");
        if (!"running".equals(state) && !"suspended".equals(state)) return;
        JSObject permission = snapshot.getJSObject("permission");
        String precision = permission.getString("precision");
        String notifications = snapshot.getJSObject("notifications").getString("state");
        refreshPermissions(this);
        if ("denied".equals(snapshot.getJSObject("permission").getString("state"))) {
            terminate(this, "permissionRevoked");
            return;
        }
        boolean enabled = androidx.core.location.LocationManagerCompat.isLocationEnabled(getSystemService(LocationManager.class));
        snapshot.put("status", enabled ? new JSObject().put("state", "running")
            : new JSObject().put("state", "suspended").put("reason", "servicesOff"));
        boolean resumed = enabled && "suspended".equals(state);
        if (resumed) armTimeout();
        if (!enabled) handler.removeCallbacks(timeout);
        if (resumed || !enabled && "running".equals(state) ||
            !precision.equals(snapshot.getJSObject("permission").getString("precision")) ||
            !notifications.equals(snapshot.getJSObject("notifications").getString("state"))) publish();
    }
    @Override public void onCreate() {
        super.onCreate();
        androidx.core.content.ContextCompat.registerReceiver(this, providers,
            new IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
        getPackageManager().addOnPermissionsChangeListener(permissions);
    }
    static boolean active() {
        return stopping || pendingStart != null || snapshot != null && ("running".equals(snapshot.getJSObject("status").getString("state")) || "suspended".equals(snapshot.getJSObject("status").getString("state")));
    }
    static void retryCleanup(Context context) {
        if (stopping && owner != null && !owner.removing && owner.teardownComplete == null) finishStop(context);
    }
    static void publish() {
        snapshot.put("revision", ++revision);
        for (Runnable observer : observers) observer.run();
    }
    static void begin(JSObject options, Context context) {
        previous = snapshot;
        snapshot = new JSObject();
        snapshot.put("id", UUID.randomUUID().toString());
        snapshot.put("startedAt", System.currentTimeMillis());
        snapshot.put("options", options);
        snapshot.put("status", new JSObject().put("state", "running"));
        snapshot.put("latest", org.json.JSONObject.NULL);
        snapshot.put("lastError", org.json.JSONObject.NULL);
        refreshPermissions(context);
    }
    static void settleStart() {
        try { persist(owner); }
        catch (IOException | RuntimeException error) { failStart(owner, error); return; }
        PluginCall call = pendingStart;
        pendingStart = null;
        previous = null;
        if (call != null) call.resolve(snapshot);
        if (stopRequested || !pendingStops.isEmpty()) stopCurrent(owner);
        else { owner.armTimeout(); owner.reconcile(); }
    }
    static void failStart(Context context, Exception error) {
        PluginCall call = pendingStart;
        pendingStart = null;
        snapshot = previous;
        previous = null;
        if (call != null) {
            String code = error instanceof SecurityException ? "PermissionDenied" :
                Build.VERSION.SDK_INT >= 31 && error instanceof ForegroundServiceStartNotAllowedException
                    ? "TrackingStartRequiresForeground" : "Unavailable";
            call.reject("Tracking startup failed", code, new JSObject().put("reason", error.toString()));
        }
        finishStop(context);
    }
    static void finishStop(Context context) {
        Runnable complete = () -> {
            stopping = false;
            for (PluginCall call : pendingStops) {
                if (snapshot != null && call.getString("id", "").equals(snapshot.getString("id"))) call.resolve(snapshot);
                else call.reject("Session not found", "TrackingSessionNotFound", new JSObject().put("id", call.getString("id")));
            }
            pendingStops.clear();
        };
        stopping = true;
        stopRequested = false;
        if (owner != null) {
            RadicalTrackingService service = owner;
            service.teardownComplete = complete;
            service.releaseCallback();
            return;
        } else context.stopService(new Intent(context, RadicalTrackingService.class));
        complete.run();
    }
    static void stopCurrent(Context context) {
        if (pendingStart != null) { stopRequested = true; return; }
        if (stopping) {
            if (owner != null && !owner.removing && owner.teardownComplete == null) finishStop(context);
            return;
        }
        terminate(context, "user");
    }
    static void terminate(Context context, String reason) {
        if (active()) {
            JSObject status = snapshot.getJSObject("status");
            snapshot.put("status", new JSObject().put("state", "stopped").put("reason", reason));
            try { persist(context); }
            catch (IOException | RuntimeException error) {
                snapshot.put("status", status);
                for (PluginCall call : pendingStops) call.reject("Cannot persist stop", "Unavailable",
                    new JSObject().put("reason", error.toString()));
                pendingStops.clear();
                return;
            }
            publish();
        }
        finishStop(context);
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        owner = this;
        if (intent == null || snapshot == null ||
            !snapshot.getString("id").equals(intent.getStringExtra("sessionId"))) {
            if (!active()) stopSelf(startId);
            return START_NOT_STICKY;
        }
        if ("stop".equals(intent.getAction())) { stopCurrent(this); return START_NOT_STICKY; }
        if (pendingStart == null || callback != null || stopping) return START_NOT_STICKY;
        final String sessionId = snapshot.getString("id");
        try {
            NotificationManager notifications = getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "Location tracking", NotificationManager.IMPORTANCE_LOW));
            Intent stop = new Intent(this, RadicalTrackingService.class).setAction("stop").putExtra("sessionId", sessionId);
            PendingIntent action = PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
            Notification notification = builder
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle(intent.getStringExtra("title")).setContentText(intent.getStringExtra("body"))
                .setOngoing(true).addAction(new Notification.Action.Builder(null, intent.getStringExtra("stop"), action).build()).build();
            startForeground(172, notification);
            JSObject options = snapshot.getJSObject("options");
            String preset = options.getString("preset");
            long interval = "balanced".equals(preset) ? 30000 : "fitness".equals(preset) ? 5000 : 1000;
            timeoutMillis = Math.max(60000, options.optLong("interval", interval) * 3);
            float distance = "balanced".equals(preset) ? 50 : "fitness".equals(preset) ? 5 : 0;
            int priority = "balanced".equals(preset) ? Priority.PRIORITY_BALANCED_POWER_ACCURACY : Priority.PRIORITY_HIGH_ACCURACY;
            LocationRequest request = new LocationRequest.Builder(priority, options.optLong("interval", interval))
                .setMinUpdateDistanceMeters((float)options.optDouble("minimumDistance", distance)).build();
            fused = LocationServices.getFusedLocationProviderClient(this);
            callback = new LocationCallback() {
                @Override public void onLocationAvailability(LocationAvailability availability) { reconcile(); }
                @Override public void onLocationResult(LocationResult result) {
                    reconcile();
                    Location location = result.getLastLocation();
                    if (pendingStart != null || stopping || snapshot == null || !"running".equals(snapshot.getJSObject("status").getString("state")) || !sessionId.equals(snapshot.getString("id")) || location == null) return;
                    JSObject fix = new JSObject();
                    fix.put("latitude", location.getLatitude()); fix.put("longitude", location.getLongitude());
                    fix.put("accuracy", location.getAccuracy()); fix.put("timestamp", location.getTime());
                    fix.put("altitude", location.hasAltitude() ? location.getAltitude() : org.json.JSONObject.NULL);
                    fix.put("altitudeAccuracy", Build.VERSION.SDK_INT >= 26 && location.hasVerticalAccuracy() ? location.getVerticalAccuracyMeters() : org.json.JSONObject.NULL);
                    fix.put("heading", location.hasBearing() ? location.getBearing() : org.json.JSONObject.NULL);
                    fix.put("speed", location.hasSpeed() ? location.getSpeed() : org.json.JSONObject.NULL);
                    snapshot.put("latest", fix); snapshot.put("lastError", org.json.JSONObject.NULL); handler.removeCallbacks(timeout); publish();
                }
            };
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper()).addOnSuccessListener(ignored -> {
                if (snapshot != null && sessionId.equals(snapshot.getString("id")) && pendingStart != null) {
                    publish();
                    settleStart();
                }
            }).addOnFailureListener(error -> {
                if (snapshot != null && sessionId.equals(snapshot.getString("id")) && pendingStart != null) failStart(this, error);
            }).addOnCanceledListener(() -> {
                if (snapshot != null && sessionId.equals(snapshot.getString("id")) && pendingStart != null)
                    failStart(this, new IllegalStateException("Location callback registration canceled"));
            });
        } catch (RuntimeException error) {
            failStart(this, error);
        }
        return START_NOT_STICKY;
    }
    private void failTeardown(String reason) {
        removing = false;
        teardownComplete = null;
        // Keep ownership and the replacement-start barrier until a retry succeeds.
        for (PluginCall call : pendingStops) {
            call.reject("Tracking teardown failed", "Unavailable", new JSObject().put("reason", reason));
        }
        pendingStops.clear();
    }
    private void released() {
        callback = null;
        removing = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (!destroyed) { stopSelf(); return; }
        if (owner == this) owner = null;
        if (teardownComplete != null) {
            Runnable complete = teardownComplete;
            teardownComplete = null;
            complete.run();
        }
    }
    private void releaseCallback() {
        handler.removeCallbacks(timeout);
        if (removing) return;
        if (callback == null) { released(); return; }
        removing = true;
        try {
            fused.removeLocationUpdates(callback).addOnCompleteListener(task -> {
                if (task.isSuccessful()) released();
                else failTeardown(task.isCanceled() ? "Location callback removal canceled" :
                    String.valueOf(task.getException()));
            });
        } catch (RuntimeException error) {
            failTeardown(error.toString());
        }
    }
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        unregisterReceiver(providers);
        getPackageManager().removeOnPermissionsChangeListener(permissions);
        destroyed = true;
        if (!stopping && pendingStart == null && active()) {
            snapshot.put("status", new JSObject().put("state", "interrupted").put("reason", "termination"));
            snapshot.put("latest", org.json.JSONObject.NULL);
            try { persist(this); }
            catch (IOException | RuntimeException error) { android.util.Log.e("RadicalTracking", "Cannot persist interruption", error); }
            publish();
        }
        stopping = true;
        if (pendingStart != null) failStart(this, new IllegalStateException("Tracking service destroyed during startup"));
        else if (teardownComplete == null) finishStop(this);
        else releaseCallback();
        super.onDestroy();
    }
}
