import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "RadicalNotificationTopics")
public class RadicalNotificationTopicsPlugin extends Plugin {
    private SharedPreferences store() { return getContext().getSharedPreferences("radical.notificationTopics", 0); }
    private boolean configured() { return !FirebaseApp.getApps(getContext()).isEmpty(); }
    @PluginMethod public void status(PluginCall call) { call.resolve(new JSObject().put("configured", configured())); }
    @PluginMethod public void list(PluginCall call) {
        call.resolve(new JSObject().put("topics", new JSArray(new java.util.ArrayList<>(store().getStringSet("topics", new HashSet<>())))));
    }
    @PluginMethod public void subscribe(PluginCall call) { update(call, true); }
    @PluginMethod public void unsubscribe(PluginCall call) { update(call, false); }
    private void update(PluginCall call, boolean subscribe) {
        String topic = call.getString("topic", "");
        if (!configured()) { call.reject("Firebase configuration is missing", "MissingPushConfiguration"); return; }
        if (!topic.matches("[a-zA-Z0-9_.~%\\-]{1,900}")) { call.reject("Invalid topic"); return; }
        com.google.android.gms.tasks.Task<Void> operation = subscribe
            ? FirebaseMessaging.getInstance().subscribeToTopic(topic)
            : FirebaseMessaging.getInstance().unsubscribeFromTopic(topic);
        operation.addOnCompleteListener(task -> {
            if (!task.isSuccessful()) { call.reject("FCM topic operation failed", task.getException()); return; }
            Set<String> topics = new HashSet<>(store().getStringSet("topics", new HashSet<>()));
            if (subscribe) topics.add(topic); else topics.remove(topic);
            if (!store().edit().putStringSet("topics", topics).commit()) { call.reject("Cannot persist topic membership"); return; }
            call.resolve();
        });
    }
}
