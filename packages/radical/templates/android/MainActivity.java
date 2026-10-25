package __APP_ID__;

import android.graphics.Bitmap;
import android.graphics.Rect;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;
import androidx.window.layout.WindowMetricsCalculator;
import android.view.PixelCopy;
import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.view.animation.DecelerateInterpolator;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.ScriptHandler;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
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
    private static final boolean BUNDLED = __BUNDLED__;
    private static final String URL = __URL__;
    private static final String OFFLINE_LAUNCH = __OFFLINE_LAUNCH__;
    private static final String OFFLINE_FALLBACK = __OFFLINE_FALLBACK__;
    private static final String SNAPSHOT_CHECK = __OFFLINE_SNAPSHOT_CHECK__;
    private static final String COOKIE = __COOKIE__;
    private static final String GUARD = __GUARD__;
    private static final Set<String> ORIGINS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(__ORIGINS__)));

    private static final String OFFLINE_URL = Uri.parse(URL).buildUpon().path("/.radical/offline").clearQuery().fragment(null).build().toString();

    private static final String LAUNCH_URL = Uri.parse(URL).buildUpon().path("/.radical/launch").clearQuery().fragment(null).build().toString();

    private static boolean launchPage(Uri uri) {
        return LAUNCH_URL.equals(uri.buildUpon().clearQuery().fragment(null).build().toString());
    }

    private static boolean offlinePage(Uri uri) {
        return OFFLINE_URL.equals(uri.buildUpon().clearQuery().fragment(null).build().toString());
    }

    private String savedOfflineUrl() {
        String saved = getPreferences(MODE_PRIVATE).getString(__OFFLINE_SAVED_URL_KEY__, URL);
        return allowed(Uri.parse(saved)) && !offlinePage(Uri.parse(saved)) && !launchPage(Uri.parse(saved)) ? saved : URL;
    }

    private String launchUrl() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        NetworkCapabilities network = manager.getNetworkCapabilities(manager.getActiveNetwork());
        return network != null && network.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ? URL : savedOfflineUrl();
    }

    private static WebResourceResponse packagedPage(WebResourceRequest request) {
        if (BUNDLED) return null;
        if (launchPage(request.getUrl())) {
            String target = request.getUrl().getQueryParameter("url");
            if (target == null || !allowed(Uri.parse(target)) || offlinePage(Uri.parse(target)) || launchPage(Uri.parse(target))) target = URL;
            String html = OFFLINE_LAUNCH.replace("%RADICAL_LAUNCH_URL%", JSONObject.quote(target).replace("<", "\\u003c"));
            return new WebResourceResponse("text/html", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
        }
        if (!offlinePage(request.getUrl())) return null;
        String retry = request.getUrl().getQueryParameter("retry");
        if (retry == null || !allowed(Uri.parse(retry)) || offlinePage(Uri.parse(retry))) retry = URL;
        String html = OFFLINE_FALLBACK.replace("%RADICAL_RETRY_URL%", TextUtils.htmlEncode(retry));
        return new WebResourceResponse("text/html", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    private void rememberOfflineUrl(WebView view, String url) {
        if (!BUNDLED && allowed(Uri.parse(url)) && !offlinePage(Uri.parse(url)) && !launchPage(Uri.parse(url))
                && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            view.evaluateJavascript(SNAPSHOT_CHECK + "(" + JSONObject.quote(url) + ");", null);
        }
    }

    private boolean started = false;
    private String lastContext = "";
    private ScriptHandler safeAreaScript;
    private WindowInfoTrackerCallbackAdapter windowTracker;
    private WindowLayoutInfo windowLayoutInfo;
    private final Consumer<WindowLayoutInfo> windowLayoutListener = info -> {
        windowLayoutInfo = info;
        refreshWindowContext();
    };

    private void refreshWindowContext() {
        if (bridge == null) return;
        WebView view = bridge.getWebView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
        if (insets != null) updateSafeArea(view, insets);
    }

    @Override
    public void onStart() {
        super.onStart();
        windowTracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(this));
        windowTracker.addWindowLayoutInfoListener(this, ContextCompat.getMainExecutor(this), windowLayoutListener);
    }

    @Override
    public void onStop() {
        if (windowTracker != null) windowTracker.removeWindowLayoutInfoListener(windowLayoutListener);
        super.onStop();
    }

    private void updateSafeArea(WebView view, WindowInsetsCompat windowInsets) {
        if (windowLayoutInfo == null || getWindow().getDecorView().getWidth() == 0) return;
        Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        // System bars remain edge to edge. Only the IME shrinks web content.
        boolean keyboardVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
        int keyboardBottom = keyboardVisible ? windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
        View content = getWindow().getDecorView();
        if (content.getPaddingBottom() != keyboardBottom) {
            content.setPadding(0, 0, 0, keyboardBottom);
        }
        float density = getResources().getDisplayMetrics().density;
        try {
            JSONObject area = new JSONObject();
            area.put("top", bars.top / density);
            area.put("right", bars.right / density);
            // The keyboard already excludes the navigation bar from usable content.
            area.put("bottom", keyboardVisible ? 0 : bars.bottom / density);
            area.put("left", bars.left / density);
            float width = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(this).getBounds().width() / density;
            JSONObject layout = new JSONObject();
            layout.put("widthClass", width < 600 ? "compact" : width < 840 ? "medium" : "expanded");
            layout.put("posture", "flat");
            layout.put("hinge", JSONObject.NULL);
            for (DisplayFeature feature : windowLayoutInfo.getDisplayFeatures()) {
                if (!(feature instanceof FoldingFeature)) continue;
                FoldingFeature fold = (FoldingFeature) feature;
                if (fold.getState() == FoldingFeature.State.HALF_OPENED) {
                    layout.put("posture", fold.getOrientation() == FoldingFeature.Orientation.HORIZONTAL ? "tabletop" : "book");
                }
                Rect bounds = fold.getBounds();
                JSONObject hinge = new JSONObject();
                hinge.put("x", bounds.left / density);
                hinge.put("y", bounds.top / density);
                hinge.put("width", bounds.width() / density);
                hinge.put("height", bounds.height() / density);
                layout.put("hinge", hinge);
                break;
            }
            JSONObject context = new JSONObject(URLDecoder.decode(MainActivity.COOKIE.split("=", 2)[1], StandardCharsets.UTF_8.name()));
            context.put("safeArea", area);
            context.put("windowLayout", layout);
            if (context.toString().equals(lastContext)) return;
            lastContext = context.toString();
            String COOKIE = "radical-context=" + URLEncoder.encode(context.toString(), StandardCharsets.UTF_8.name()).replace("+", "%20");
            CookieManager cookies = CookieManager.getInstance();
            __COOKIES__
            cookies.flush();
            String script = "window.__radicalBundled=" + BUNDLED + ";window.__radicalNativeContext=" + context + ";" + __SAFE_AREA_SCRIPT__ + area + ");" + __WINDOW_LAYOUT_SCRIPT__ + layout + ");";
            if (safeAreaScript != null) safeAreaScript.remove();
            safeAreaScript = WebViewCompat.addDocumentStartJavaScript(view, script, ORIGINS);
            if (!started) {
                started = true;
                view.getSettings().setBlockNetworkLoads(false);
                // Establish the origin and finish registration lookup before the
                // renderer navigates to the app, including on a cold offline start.
                view.loadUrl(BUNDLED ? URL : Uri.parse(LAUNCH_URL).buildUpon().appendQueryParameter("url", launchUrl()).build().toString());
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
        // Only packaged startup and fallback pages need native worker interception. Ordinary
        // worker fetches, including cross-origin requests, use Chromium networking.
        if (!BUNDLED && WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)
                && WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return packagedPage(request);
                }
            });
        }
        __PLUGIN_REGISTRATION__
        super.load();
        view.stopLoading();
        // Radical owns WebView history without requiring Capacitor's optional App plugin.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (view.canGoBack()) { view.goBack(); return; }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
        // Without document-start scripts the allowlist cannot stop a redirected
        // document before its scripts run, so the shell refuses to start.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.e("RadicalNavigation", "WebView lacks document-start script support");
            finish();
            return;
        }
        WebViewCompat.addDocumentStartJavaScript(view, GUARD, Collections.singleton("*"));
        if (!BUNDLED && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view, "radicalOffline", ORIGINS, (webView, message, sourceOrigin, isMainFrame, reply) -> {
                String url = message.getData();
                if (isMainFrame && url != null && url.equals(webView.getUrl())
                        && allowed(Uri.parse(url)) && !offlinePage(Uri.parse(url)) && !launchPage(Uri.parse(url))) {
                    getPreferences(MODE_PRIVATE).edit().putString(__OFFLINE_SAVED_URL_KEY__, url).apply();
                }
            });
        }
        // Radical owns edge-to-edge layout; SystemBars inset handling is disabled.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, windowInsets) -> {
            updateSafeArea(view, windowInsets);
            return windowInsets;
        });
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                WebResourceResponse fallback = packagedPage(request);
                if (fallback != null) return fallback;
                if (request.isForMainFrame()) {
                    if (!allowed(request.getUrl())) {
                        Log.i("RadicalNavigation", "Blocked " + request.getUrl());
                        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked by radical allowlist", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                    }
                    // Capacitor's remote-document proxy uses HttpURLConnection and
                    // bypasses the worker. Document-start injection supplies the bridge.
                    return BUNDLED ? super.shouldInterceptRequest(webView, request) : null;
                }
                return super.shouldInterceptRequest(webView, request);
            }

            @Override
            public void onPageFinished(WebView webView, String url) {
                super.onPageFinished(webView, url);
                rememberOfflineUrl(webView, url);
            }

            @Override
            public void doUpdateVisitedHistory(WebView webView, String url, boolean isReload) {
                super.doUpdateVisitedHistory(webView, url, isReload);
                // Client-side history updates also count, but only if a snapshot exists.
                rememberOfflineUrl(webView, url);
            }

            @Override
            public void onReceivedError(WebView webView, WebResourceRequest request, WebResourceError error) {
                if (BUNDLED || !request.isForMainFrame()) return;
                if (!allowed(request.getUrl())) return;
                Log.i("RadicalOffline", "Main-frame load failed: " + error.getErrorCode() + " " + request.getUrl());
                // A controlling worker already tried snapshots and the app fallback.
                // Without one, packaged HTML works even on the very first launch.
                webView.stopLoading();
                webView.loadUrl(Uri.parse(OFFLINE_URL).buildUpon().appendQueryParameter("retry", request.getUrl().toString()).build().toString());
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
        view.addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> refreshWindowContext());
        WindowInsetsCompat initial = ViewCompat.getRootWindowInsets(view);
        if (initial != null) updateSafeArea(view, initial);
        ViewCompat.requestApplyInsets(view);
    }

}
