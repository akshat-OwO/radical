import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RadicalSplash")
public class RadicalSplashPlugin extends Plugin {
    // Hiding twice, or after the timeout, resolves without effect.
    @PluginMethod public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).hideSplash();
            call.resolve();
        });
    }
}
