package __APP_ID__;

import android.graphics.Bitmap;
import android.net.Uri;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;

/** Remote mode keeps Chromium's networking, streaming, cookies and origin. */
public class MainActivity extends BridgeActivity {
    private static final String URL = __URL__;
    private static final String COOKIE = __COOKIE__;
    private static final String GUARD = __GUARD__;
    private static final Set<String> ORIGINS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(__ORIGINS__)));

    private boolean started = false;
    private String lastInsets = "";
    private ScriptHandler safeAreaScript;

    private void updateSafeArea(WebView view, WindowInsetsCompat windowInsets) {
        Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        float density = getResources().getDisplayMetrics().density;
        try {
            JSONObject area = new JSONObject();
            area.put("top", bars.top / density);
            area.put("right", bars.right / density);
            area.put("bottom", bars.bottom / density);
            area.put("left", bars.left / density);
            if (area.toString().equals(lastInsets)) return;
            lastInsets = area.toString();
            JSONObject context = new JSONObject(URLDecoder.decode(MainActivity.COOKIE.split("=", 2)[1], StandardCharsets.UTF_8.name()));
            context.put("safeArea", area);
            String COOKIE = "radical-context=" + URLEncoder.encode(context.toString(), StandardCharsets.UTF_8.name()).replace("+", "%20");
            CookieManager cookies = CookieManager.getInstance();
            __COOKIES__
            cookies.flush();
            String script = "window.radicalSafeArea=" + area + ";window.dispatchEvent(new CustomEvent('radicalSafeArea',{detail:window.radicalSafeArea}));";
            if (safeAreaScript != null) safeAreaScript.remove();
            safeAreaScript = WebViewCompat.addDocumentStartJavaScript(view, script, ORIGINS);
            if (!started) {
                started = true;
                view.getSettings().setBlockNetworkLoads(false);
                view.loadUrl(URL);
            } else {
                view.evaluateJavascript(script, null);
            }
        } catch (Exception error) {
            Log.e("RadicalSafeArea", "Cannot prepare native context", error);
            finish();
        }
    }

    private static boolean allowed(Uri uri) {
        if (!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) return false;
        return ORIGINS.contains(uri.getScheme() + "://" + uri.getEncodedAuthority());
    }

    @Override
    protected void load() {
        // Capacitor installs the bridge before radical starts remote navigation.
        WebView view = findViewById(com.getcapacitor.android.R.id.webview);
        view.getSettings().setBlockNetworkLoads(true);
        super.load();
        view.stopLoading();
        // Without document-start scripts the allowlist cannot stop a redirected
        // document before its scripts run, so the shell refuses to start.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.e("RadicalNavigation", "WebView lacks document-start script support");
            finish();
            return;
        }
        WebViewCompat.addDocumentStartJavaScript(view, GUARD, Collections.singleton("*"));
        // Radical owns edge-to-edge layout; SystemBars inset handling is disabled.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, windowInsets) -> {
            updateSafeArea(view, windowInsets);
            return windowInsets;
        });
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                if (request.isForMainFrame() && !allowed(request.getUrl())) {
                    Log.i("RadicalNavigation", "Blocked " + request.getUrl());
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked by radical allowlist", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(webView, request);
            }

            @Override
            public void onPageStarted(WebView webView, String url, Bitmap favicon) {
                // WebView skips shouldOverrideUrlLoading for non-GET navigations, and
                // shouldInterceptRequest sees only the first URL. A POST redirected by
                // 307 or 308 to another origin first surfaces here, after commit; the
                // document-start guard has already stopped its scripts.
                if (!allowed(Uri.parse(url))) {
                    Log.i("RadicalNavigation", "Blocked " + url);
                    webView.stopLoading();
                    if (webView.canGoBack()) webView.goBack();
                    else webView.loadUrl(URL);
                    return;
                }
                super.onPageStarted(webView, url, favicon);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                if (!allowed(request.getUrl())) {
                    Log.i("RadicalNavigation", "Blocked " + request.getUrl());
                    return true;
                }
                return false;
            }
        });
        WindowInsetsCompat initial = ViewCompat.getRootWindowInsets(view);
        if (initial != null) updateSafeArea(view, initial);
        ViewCompat.requestApplyInsets(view);
    }
}
