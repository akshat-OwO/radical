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
    private static long revision;
    static final CopyOnWriteArraySet<Runnable> observers = new CopyOnWriteArraySet<>();
    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private static final String CHANNEL = "radical_tracking";
    static boolean active() {
        return snapshot != null && "running".equals(snapshot.getJSObject("status").getString("state"));
    }
    static void publish() {
        snapshot.put("revision", ++revision);
        for (Runnable observer : observers) observer.run();
    }
    static void begin(JSObject options, Context context) {
        snapshot = new JSObject();
        snapshot.put("id", UUID.randomUUID().toString());
        snapshot.put("startedAt", System.currentTimeMillis());
        snapshot.put("options", options);
        snapshot.put("status", new JSObject().put("state", "running"));
        snapshot.put("latest", org.json.JSONObject.NULL);
        snapshot.put("lastError", org.json.JSONObject.NULL);
        snapshot.put("permission", new JSObject().put("state", "granted").put("precision",
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ? "precise" : "approximate"));
        publish();
    }
    static void stopCurrent(Context context) {
        if (active()) {
            snapshot.put("status", new JSObject().put("state", "stopped").put("reason", "user"));
            publish();
            context.stopService(new Intent(context, RadicalTrackingService.class));
        }
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !active()) {
            if (pendingStart != null) { pendingStart.resolve(snapshot); pendingStart = null; }
            stopSelf(); return START_NOT_STICKY;
        }
        if ("stop".equals(intent.getAction())) { stopCurrent(this); return START_NOT_STICKY; }
        final PluginCall startingCall = pendingStart;
        pendingStart = null;
        final JSObject started = snapshot;
        NotificationManager notifications = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "Location tracking", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, RadicalTrackingService.class).setAction("stop");
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
        String sessionId = snapshot.getString("id");
        callback = new LocationCallback() {
            @Override public void onLocationResult(LocationResult result) {
                Location location = result.getLastLocation();
                if (!active() || !sessionId.equals(snapshot.getString("id")) || location == null) return;
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
            if (startingCall != null) startingCall.resolve(started);
        }).addOnFailureListener(error -> {
            if (snapshot == started) stopCurrent(this);
            if (startingCall != null) startingCall.reject("Location updates unavailable", "Unavailable", new JSObject().put("reason", error.toString()));
        });
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        if (fused != null && callback != null) fused.removeLocationUpdates(callback);
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
