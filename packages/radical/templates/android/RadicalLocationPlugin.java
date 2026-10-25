import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.provider.Settings;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "RadicalLocation", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }),
    @Permission(alias = "coarseLocation", strings = { Manifest.permission.ACCESS_COARSE_LOCATION })
})
public class RadicalLocationPlugin extends Plugin {
    // Capacitor reads actual grants and its per-permission denial history without consulting location services.
    @Override @PermissionCallback @PluginMethod public void checkPermissions(PluginCall call) {
        super.checkPermissions(call);
    }
    @Override @PluginMethod public void requestPermissions(PluginCall call) {
        // The base flow requests the supplied aliases and returns through checkPermissions,
        // preserving prompt-with-rationale and permanent-denial tracking even with services off.
        super.requestPermissions(call);
    }
    // The Capacitor plugin instance belongs to this bridge runtime.
    private Boolean playServicesAvailable;
    @PluginMethod public void playServicesAvailability(PluginCall call) {
        if (playServicesAvailable == null) {
            playServicesAvailable = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
        }
        JSObject result = new JSObject();
        result.put("available", playServicesAvailable);
        call.resolve(result);
    }
    @PluginMethod public void accuracyAuthorization(PluginCall call) {
        JSObject result = new JSObject();
        result.put("precision", getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ? "precise" : "approximate");
        call.resolve(result);
    }
    @PluginMethod public void requestTemporaryFullAccuracy(PluginCall call) { accuracyAuthorization(call); }
    private void activity(boolean active) {
        JSObject value = new JSObject();
        value.put("active", active);
        notifyListeners("appStateChange", value, true);
    }
    // Visibility, not focus: Google's translucent settings dialog pauses the activity without hiding it.
    @Override protected void handleOnStop() { activity(false); }
    @Override protected void handleOnStart() { activity(true); }
    @PluginMethod public void openLocationServicesSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) { call.reject("Location settings unavailable"); return; }
        getActivity().startActivity(intent);
        call.resolve();
    }
}
