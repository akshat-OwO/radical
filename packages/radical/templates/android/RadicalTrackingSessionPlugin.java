import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.Manifest;

@CapacitorPlugin(name = "RadicalTrackingSession")
public class RadicalTrackingSessionPlugin extends Plugin {
    private boolean visible;
    private final Runnable observer = () -> {
        JSObject session = RadicalTrackingService.snapshot;
        if (session != null) {
            JSObject event = new JSObject();
            event.put("sessionId", session.getString("id"));
            event.put("revision", session.optLong("revision"));
            event.put("session", session);
            notifyListeners("trackingSessionChange", event);
        }
    };
    @Override public void load() {
        getActivity().runOnUiThread(() -> RadicalTrackingService.hydrate(getContext()));
        visible = getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED);
        RadicalTrackingService.observers.add(observer);
    }
    @Override protected void handleOnStart() {
        visible = true;
        getActivity().runOnUiThread(() -> {
            RadicalTrackingService.hydrate(getContext());
            if (RadicalTrackingService.owner != null) RadicalTrackingService.owner.reconcile();
            notifyListeners("appStateChange", new JSObject().put("active", true));
        });
    }
    @Override protected void handleOnStop() { visible = false; }
    @Override protected void handleOnDestroy() { RadicalTrackingService.observers.remove(observer); }
    @PluginMethod public void getTrackingSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            RadicalTrackingService.hydrate(getContext());
            if (RadicalTrackingService.owner != null) RadicalTrackingService.owner.reconcile();
            JSObject result = new JSObject();
            JSObject session = RadicalTrackingService.pendingStart == null ? RadicalTrackingService.snapshot : RadicalTrackingService.previous;
            result.put("session", session == null ? org.json.JSONObject.NULL : session);
            call.resolve(result);
        });
    }
    @PluginMethod public void startTrackingSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            RadicalTrackingService.hydrate(getContext());
            RadicalTrackingService.retryCleanup(getContext());
            JSObject current = RadicalTrackingService.snapshot;
            if (RadicalTrackingService.active()) {
                call.reject("Session already active", "TrackingSessionAlreadyActive", new JSObject().put("id", current == null ? "" : current.getString("id"))); return;
            }
            if (!visible) { call.reject("Activity must be visible", "TrackingStartRequiresForeground"); return; }
            LocationManager manager = (LocationManager)getContext().getSystemService(android.content.Context.LOCATION_SERVICE);
            if (!androidx.core.location.LocationManagerCompat.isLocationEnabled(manager)) { call.reject("Location services off", "LocationServicesOff"); return; }
            if (getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                call.reject("Location permission required", "PermissionDenied"); return;
            }
            String preset = call.getString("preset", "");
            Double interval = call.getDouble("interval");
            Double distance = call.getDouble("minimumDistance");
            if ((!preset.equals("balanced") && !preset.equals("fitness") && !preset.equals("navigation")) ||
                (interval != null && (!Double.isFinite(interval) || interval <= 0)) ||
                (distance != null && (!Double.isFinite(distance) || distance < 0))) {
                call.reject("Invalid tracking options", "InvalidTrackingOptions", new JSObject().put("message", "Invalid preset, interval or minimumDistance")); return;
            }
            RadicalTrackingService.begin(call.getData(), getContext());
            Intent intent = new Intent(getContext(), RadicalTrackingService.class);
            intent.putExtra("sessionId", RadicalTrackingService.snapshot.getString("id"));
            intent.putExtra("title", getConfig().getString("notificationTitle", "Location tracking"));
            intent.putExtra("body", getConfig().getString("notificationBody", "Tracking your location"));
            intent.putExtra("stop", getConfig().getString("stopActionLabel", "Stop"));
            RadicalTrackingService.pendingStart = call;
            try {
                androidx.core.content.ContextCompat.startForegroundService(getContext(), intent);
            } catch (RuntimeException error) {
                RadicalTrackingService.failStart(getContext(), error);
            }
        });
    }
    @PluginMethod public void stopTrackingSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject current = RadicalTrackingService.snapshot;
            String id = call.getString("id", "");
            if (current == null || !id.equals(current.getString("id"))) {
                call.reject("Session not found", "TrackingSessionNotFound", new JSObject().put("id", id)); return;
            }
            RadicalTrackingService.pendingStops.add(call);
            RadicalTrackingService.stopCurrent(getContext());
        });
    }
}
