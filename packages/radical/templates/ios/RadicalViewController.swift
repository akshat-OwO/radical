import Capacitor
import WebKit

// Remote mode uses WebKit's networking and persistent cookie store.
// Capacitor sets limitsNavigationsToAppBoundDomains before creating the WebView.
final class RadicalViewController: CAPBridgeViewController {
    private var navigationProxy: RadicalNavigationDelegate?
    private var startupSplash: UIImageView?

    private var urlObservation: NSKeyValueObservation?
    private var started = false
    private var writing = false
    private var laidOut = false
    private var lastInsets: UIEdgeInsets?
    private var safeAreaScript: WKUserScript?

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.websiteDataStore = .default()
        return configuration
    }

    override func capacitorDidLoad() {
        __PLUGIN_REGISTRATION__
    }

    override func viewDidLoad() {
        // Delay Capacitor's initial navigation until window layout and cookies are ready.
        guard let webView = webView, let delegate = webView.navigationDelegate else { fatalError("Radical requires Capacitor WebView") }
        let proxy = RadicalNavigationDelegate(delegate: delegate, origins: [__ORIGINS__], errorPathURL: bridge?.config.errorPathURL)
        navigationProxy = proxy
        let splashName = __SPLASH_NAME__
        if !splashName.isEmpty, let image = UIImage(named: splashName) {
            let splash = UIImageView(image: image)
            splash.frame = view.bounds
            splash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            splash.contentMode = .scaleAspectFill
            view.addSubview(splash)
            startupSplash = splash
        }
        proxy.onDocumentReady = { [weak self] in
            self?.startupSplash?.removeFromSuperview()
            self?.startupSplash = nil
        }
        webView.navigationDelegate = proxy
        let controller = webView.configuration.userContentController
        if !__BUNDLED__ {
            controller.add(proxy, name: "radicalOffline")
            controller.addUserScript(WKUserScript(source: __SNAPSHOT_CHECK__, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            // WKWebView URL observation also covers client-side history navigation.
            urlObservation = webView.observe(\.url, options: [.new]) { [weak webView] _, _ in
                webView?.evaluateJavaScript(__SNAPSHOT_CHECK__, completionHandler: nil)
            }
        }
        // viewport-fit=cover keeps safe-area padding in CSS; UIKit still adjusts for the keyboard.
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        laidOut = true
        updateSafeArea()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        updateSafeArea()
    }

    private func updateSafeArea() {
        guard let webView = webView, view.window != nil, laidOut, !writing else { return }
        let insets = view.safeAreaInsets
        guard lastInsets != insets else { return }
        writing = true
        let area: [String: CGFloat] = ["top": insets.top, "right": insets.right, "bottom": insets.bottom, "left": insets.left]
        let seed = __COOKIE_VALUE__.removingPercentEncoding!.data(using: .utf8)!
        var context = try! JSONSerialization.jsonObject(with: seed) as! [String: Any]
        context["safeArea"] = area
        let data = try! JSONSerialization.data(withJSONObject: context, options: [.sortedKeys])
        let value = String(data: data, encoding: .utf8)!.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let areaJSON = String(data: try! JSONSerialization.data(withJSONObject: area), encoding: .utf8)!
        let script = "window.__radicalBundled=" + String(__BUNDLED__) + ";window.__radicalNativeContext=" + String(data: data, encoding: .utf8)! + ";" + __SAFE_AREA_SCRIPT__ + areaJSON + ");"
        let group = DispatchGroup()
        for (hostname, origin, secure) in [__COOKIES__] as [(String, String, Bool)] {
            let url = URL(string: origin)!
            var properties: [HTTPCookiePropertyKey: Any] = [
                .originURL: url, .domain: hostname, .path: "/",
                .name: __COOKIE_NAME__, .value: value,
                HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax
            ]
            if secure { properties[.secure] = "TRUE" }
            let cookie = HTTPCookie(properties: properties)!
            group.enter()
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            self.writing = false
            self.lastInsets = insets
            // Replace only our user script, preserving Capacitor's bridge scripts.
            let controller = webView.configuration.userContentController
            let scripts = controller.userScripts.filter { $0 !== self.safeAreaScript }
            controller.removeAllUserScripts()
            for existing in scripts { controller.addUserScript(existing) }
            let injection = WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            self.safeAreaScript = injection
            controller.addUserScript(injection)
            if self.view.safeAreaInsets != insets { self.updateSafeArea(); return }
            if !self.started { self.started = true; self.startNavigation() }
            else { webView.evaluateJavaScript(script, completionHandler: nil) }
        }
    }

    private func startNavigation() { super.viewDidLoad() }

}

// navigationDelegate is weak; the controller retains this proxy and it retains Capacitor.
final class RadicalNavigationDelegate: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var onDocumentReady: (() -> Void)?
    private let serverURL = URL(string: __URL__)!
    private let savedURLKey = "radical.lastOfflineURL"
    private var launching = true
    private var attemptedSnapshot = false
    private var showingFallback = false
    private var activeNavigation: WKNavigation?
    private var recoveryCancellations: Set<WKNavigation> = []
    private let delegate: WKNavigationDelegate
    private let origins: Set<String>
    private let errorPathURL: URL?

    init(delegate: WKNavigationDelegate, origins: Set<String>, errorPathURL: URL?) {
        self.delegate = delegate
        self.origins = origins
        self.errorPathURL = errorPathURL
        super.init()
    }

    private func allowed(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return false }
        let port = url.port
        let defaultPort = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
        let suffix = port == nil || defaultPort ? "" : ":\(port!)"
        return origins.contains("\(scheme)://\(host)\(suffix)")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url,
           action.targetFrame == nil || action.targetFrame?.isMainFrame == true,
           (__BUNDLED__ || url.scheme == "http" || url.scheme == "https"),
           !allowed(url) {
            if action.navigationType == .linkActivated { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
            return
        }
        if action.navigationType == .linkActivated, let url = action.request.url, allowed(url) {
            showingFallback = false
        }
        if delegate.webView?(webView, decidePolicyFor: action, decisionHandler: decisionHandler) == nil {
            decisionHandler(.allow)
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let value = message.body as? String, let url = URL(string: value),
              allowed(url), message.webView?.url == url,
              let frameURL = message.frameInfo.request.url, allowed(frameURL),
              !showingFallback else { return }
        UserDefaults.standard.set(value, forKey: savedURLKey)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        activeNavigation = navigation
        delegate.webView?(webView, didStartProvisionalNavigation: navigation)
    }

    // Mark the exact navigation before cancelling or replacing it. A later callback
    // for that navigation must not let Capacitor's errorPath replace our recovery.
    private func prepareRecovery() {
        if let navigation = activeNavigation { recoveryCancellations.insert(navigation) }
    }

    private func completed(_ navigation: WKNavigation?) {
        if activeNavigation === navigation { activeNavigation = nil }
    }

    // A failed server launch may have a worker fallback rather than a native error.
    // Both paths try the last confirmed snapshot once before showing the fallback.
    private func restoreSnapshot(_ webView: WKWebView, failed: URL) -> Bool {
        guard !__BUNDLED__, launching, !attemptedSnapshot,
              let value = UserDefaults.standard.string(forKey: savedURLKey),
              let url = URL(string: value), allowed(url), url != failed else { return false }
        attemptedSnapshot = true
        prepareRecovery()
        activeNavigation = webView.load(URLRequest(url: url))
        return true
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let url = response.response.url {
            // Capacitor serves its configured error page from packaged local assets.
            guard allowed(url) || url == errorPathURL else { decisionHandler(.cancel); return }
            if (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "x-radical-offline-fallback") == "1",
               launching, !attemptedSnapshot,
               let value = UserDefaults.standard.string(forKey: savedURLKey),
               let saved = URL(string: value), allowed(saved), saved != url {
                prepareRecovery()
                decisionHandler(.cancel)
                _ = restoreSnapshot(webView, failed: url)
                return
            }
        }
        if delegate.webView?(webView, decidePolicyFor: response, decisionHandler: decisionHandler) == nil {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let navigation = navigation { recoveryCancellations.remove(navigation) }
        completed(navigation)
        launching = false
        onDocumentReady?()
        if !__BUNDLED__ && !showingFallback { webView.evaluateJavaScript(__SNAPSHOT_CHECK__, completionHandler: nil) }
        delegate.webView?(webView, didFinish: navigation)
    }

    // Handle recovery and its own cancellation callbacks here. Capacitor must not
    // start a competing errorPath navigation over our snapshot or packaged fallback.
    private func handleFailure(_ webView: WKWebView, navigation: WKNavigation?, error: Error) -> Bool {
        if __BUNDLED__ { return false }
        let error = error as NSError
        let replaced = navigation.map { recoveryCancellations.remove($0) != nil } ?? false
        completed(navigation)
        // Consume only our replaced navigation's cancellation. Unrelated cancellations
        // still reach Capacitor, even if a recovery navigation is now in flight.
        if (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) ||
           (error.domain == "WebKitErrorDomain" && error.code == 102) { return replaced }
        let url = (error.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url ?? serverURL
        guard allowed(url), !showingFallback else { return false }
        if restoreSnapshot(webView, failed: url) { return true }
        showingFallback = true
        launching = false
        let retry = url.absoluteString.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        // WKURLSchemeHandler cannot serve HTTPS. This packaged document retains
        // the allowed base origin and requires neither a worker nor any network.
        prepareRecovery()
        activeNavigation = webView.loadHTMLString(__OFFLINE_HTML__.replacingOccurrences(of: "%RADICAL_RETRY_URL%", with: retry), baseURL: url)
        return true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !handleFailure(webView, navigation: navigation, error: error) {
            delegate.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if !handleFailure(webView, navigation: navigation, error: error) {
            delegate.webView?(webView, didFail: navigation, withError: error)
        }
    }

    // Forward every remaining optional callback to Capacitor.
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || delegate.responds(to: selector)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        delegate.responds(to: selector) ? delegate : super.forwardingTarget(for: selector)
    }
}
