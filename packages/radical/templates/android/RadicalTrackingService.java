import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.Location;
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
    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private Runnable teardownComplete;
    private boolean removing;
    private boolean destroyed;
    private static final String CHANNEL = "radical_tracking";
    static boolean active() {
        return stopping || pendingStart != null || snapshot != null && "running".equals(snapshot.getJSObject("status").getString("state"));
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
        snapshot.put("permission", new JSObject().put("state", "granted").put("precision",
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ? "precise" : "approximate"));
    }
    static void settleStart() {
        PluginCall call = pendingStart;
        pendingStart = null;
        previous = null;
        if (call != null) call.resolve(snapshot);
        if (stopRequested || !pendingStops.isEmpty()) stopCurrent(owner);
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
        if (active()) {
            snapshot.put("status", new JSObject().put("state", "stopped").put("reason", "user"));
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
            float distance = "balanced".equals(preset) ? 50 : "fitness".equals(preset) ? 5 : 0;
            int priority = "balanced".equals(preset) ? Priority.PRIORITY_BALANCED_POWER_ACCURACY : Priority.PRIORITY_HIGH_ACCURACY;
            LocationRequest request = new LocationRequest.Builder(priority, options.optLong("interval", interval))
                .setMinUpdateDistanceMeters((float)options.optDouble("minimumDistance", distance)).build();
            fused = LocationServices.getFusedLocationProviderClient(this);
            callback = new LocationCallback() {
                @Override public void onLocationResult(LocationResult result) {
                    Location location = result.getLastLocation();
                    if (pendingStart != null || stopping || snapshot == null || !"running".equals(snapshot.getJSObject("status").getString("state")) || !sessionId.equals(snapshot.getString("id")) || location == null) return;
                    JSObject fix = new JSObject();
                    fix.put("latitude", location.getLatitude()); fix.put("longitude", location.getLongitude());
                    fix.put("accuracy", location.getAccuracy()); fix.put("timestamp", location.getTime());
                    fix.put("altitude", location.hasAltitude() ? location.getAltitude() : org.json.JSONObject.NULL);
                    fix.put("altitudeAccuracy", Build.VERSION.SDK_INT >= 26 && location.hasVerticalAccuracy() ? location.getVerticalAccuracyMeters() : org.json.JSONObject.NULL);
                    fix.put("heading", location.hasBearing() ? location.getBearing() : org.json.JSONObject.NULL);
                    fix.put("speed", location.hasSpeed() ? location.getSpeed() : org.json.JSONObject.NULL);
                    snapshot.put("latest", fix); publish();
                }
            };
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper()).addOnSuccessListener(ignored -> {
                if (snapshot != null && sessionId.equals(snapshot.getString("id")) && pendingStart != null) {
                    publish();
                    settleStart();
                }
            }).addOnFailureListener(error -> {
                if (snapshot != null && sessionId.equals(snapshot.getString("id")) && pendingStart != null) failStart(this, error);
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
        destroyed = true;
        stopping = true;
        if (pendingStart != null) failStart(this, new IllegalStateException("Tracking service destroyed during startup"));
        else if (teardownComplete == null) finishStop(this);
        else releaseCallback();
        super.onDestroy();
    }
}
