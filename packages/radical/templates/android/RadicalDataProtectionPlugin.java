import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;

@CapacitorPlugin(name = "RadicalDataProtection")
public class RadicalDataProtectionPlugin extends Plugin {
    @PluginMethod
    public void setProtection(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) { call.reject("enabled is required"); return; }
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            result.put("screenshots", enabled);
            result.put("recording", enabled);
            result.put("appSwitcher", enabled);
            call.resolve(result);
        });
    }

    private void deleteContents(File directory) throws IOException {
        File[] files = directory.listFiles();
        if (files == null) {
            if (directory.exists()) throw new IOException("Cannot list " + directory);
            return;
        }
        for (File file : files) {
            if (file.isDirectory()) deleteContents(file);
            if (!file.delete() && file.exists()) throw new IOException("Cannot delete " + file);
        }
    }

    @PluginMethod
    public void clearWebData(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            PluginHandle transitions = getBridge().getPlugin("RadicalTransitions");
            // Transitions is optional; resolve its cleanup method without linking its class.
            if (transitions != null) {
                Plugin plugin = transitions.getInstance();
                try { plugin.getClass().getMethod("clearData").invoke(plugin); }
                catch (ReflectiveOperationException error) { call.reject("Cannot clear transition overlay", error); return; }
            }
            getBridge().getWebView().clearCache(true);
            getBridge().getWebView().clearHistory();
            getBridge().getWebView().clearFormData();
            WebStorage.getInstance().deleteAllData();
            CookieManager.getInstance().removeAllCookies(removed -> {
                CookieManager.getInstance().flush();
                // Cache traversal is disk IO; never block the UI thread on it.
                getBridge().execute(() -> {
                    try {
                        if (!getActivity().getPreferences(android.content.Context.MODE_PRIVATE).edit().remove("lastOfflineUrl").commit()) {
                            call.reject("Cannot clear saved offline URL"); return;
                        }
                        if (!getContext().getSharedPreferences("radical.notificationTopics", android.content.Context.MODE_PRIVATE).edit().clear().commit()) {
                            call.reject("Cannot clear notification topic membership"); return;
                        }
                        deleteContents(getContext().getCacheDir());
                        deleteContents(getContext().getCodeCacheDir());
                        call.resolve();
                    } catch (IOException error) { call.reject("Cannot clear native caches", error); }
                });
            });
        });
    }
}
