package __APP_ID__;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.util.Log;
import java.io.ByteArrayInputStream;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Collections;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

/** Remote mode keeps Chromium's networking, streaming, cookies and origin. */
public class MainActivity extends BridgeActivity {
    private static final String URL = __URL__;
    private static final String HEADER = __HEADER__;
    private static final String CONTEXT = __CONTEXT__;
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
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            finish();
            return;
        }
        // Insets are applied outside the WebView, so its CSS safe area is zero.
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(view);
        WebViewCompat.addDocumentStartJavaScript(view, __SCRIPT__, ORIGINS);
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
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                if (!allowed(request.getUrl())) {
                    Log.i("RadicalNavigation", "Blocked " + request.getUrl());
                    return true;
                }
                if (request.isForMainFrame() && "GET".equals(request.getMethod())) {
                    webView.loadUrl(request.getUrl().toString(), Collections.singletonMap(HEADER, CONTEXT));
                    return true;
                }
                return false;
            }
        });
        view.getSettings().setBlockNetworkLoads(false);
        view.loadUrl(URL, Collections.singletonMap(HEADER, CONTEXT));
    }
}
