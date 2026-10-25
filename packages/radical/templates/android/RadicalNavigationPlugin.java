import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RadicalNavigation")
public class RadicalNavigationPlugin extends Plugin {
    @PluginMethod public void update(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).navigation.update(call.getData());
            call.resolve();
        });
    }
}
