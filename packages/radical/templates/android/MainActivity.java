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
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Remote mode keeps Chromium's networking, streaming, cookies and origin. */
public class MainActivity extends BridgeActivity {
    private static final String URL = __URL__;
    private static final String COOKIE = __COOKIE__;
    private static final String GUARD = __GUARD__;
    private static final Set<String> ORIGINS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(__ORIGINS__)));

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
        // The WebView sends the native context cookie with every request to an allowed origin.
        CookieManager cookies = CookieManager.getInstance();
        for (String origin : ORIGINS) {
            String secure = origin.startsWith("https:") ? "; Secure" : "";
            cookies.setCookie(origin, COOKIE + "; Path=/; HttpOnly; SameSite=Lax" + secure);
        }
        cookies.flush();
        // Insets are applied outside the WebView, so its CSS safe area is zero.
        // Safe-area support (#7) replaces this with real insets in native context.
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(view);
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
        view.getSettings().setBlockNetworkLoads(false);
        view.loadUrl(URL);
    }
}
