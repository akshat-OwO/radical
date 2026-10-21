import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Echo")
public class EchoPlugin extends Plugin {
    @PluginMethod
    public void echo(PluginCall call) {
        String text = call.getString("text", "");
        JSObject result = new JSObject();
        if (text.equals("deny")) {
            result.put("reason", "The example rejected this input");
            call.reject("Rejected", "EchoRejected", result);
            return;
        }
        result.put("text", getConfig().getString("prefix", "") + text);
        call.resolve(result);
    }
}
