import Capacitor
import WebKit

// Remote mode uses WebKit's networking and persistent cookie store.
// Capacitor sets limitsNavigationsToAppBoundDomains before creating the WebView.
final class RadicalViewController: CAPBridgeViewController {
    private var navigationProxy: RadicalNavigationDelegate?

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

    override func viewDidLoad() {
        // Delay Capacitor's initial navigation until window layout and cookies are ready.
        guard let webView = webView, let delegate = webView.navigationDelegate else { fatalError("Radical requires Capacitor WebView") }
        let proxy = RadicalNavigationDelegate(delegate: delegate, origins: [__ORIGINS__])
        navigationProxy = proxy
        webView.navigationDelegate = proxy
        let controller = webView.configuration.userContentController
        controller.add(proxy, name: "radicalOffline")
        controller.addUserScript(WKUserScript(source: __SNAPSHOT_CHECK__, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        // WKWebView URL observation also covers client-side history navigation.
        urlObservation = webView.observe(\.url, options: [.new]) { [weak webView] _, _ in
            webView?.evaluateJavaScript(__SNAPSHOT_CHECK__, completionHandler: nil)
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
        let script = __SAFE_AREA_SCRIPT__ + areaJSON + ");"
        let group = DispatchGroup()
        for (hostname, origin, secure) in [__COOKIES__] {
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
    private let serverURL = URL(string: __URL__)!
    private let savedURLKey = "radical.lastOfflineURL"
    private var launching = true
    private var attemptedSnapshot = false
    private var showingFallback = false
    private let delegate: WKNavigationDelegate
    private let origins: Set<String>

    init(delegate: WKNavigationDelegate, origins: Set<String>) {
        self.delegate = delegate
        self.origins = origins
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
           url.scheme == "http" || url.scheme == "https",
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

    // A failed server launch may have a worker fallback rather than a native error.
    // Both paths try the last confirmed snapshot once before showing the fallback.
    private func restoreSnapshot(_ webView: WKWebView, failed: URL) -> Bool {
        guard launching, !attemptedSnapshot,
              let value = UserDefaults.standard.string(forKey: savedURLKey),
              let url = URL(string: value), allowed(url), url != failed else { return false }
        attemptedSnapshot = true
        webView.load(URLRequest(url: url))
        return true
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let url = response.response.url {
            guard allowed(url) else { decisionHandler(.cancel); return }
            if (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "x-radical-offline-fallback") == "1",
               launching, !attemptedSnapshot,
               let value = UserDefaults.standard.string(forKey: savedURLKey),
               let saved = URL(string: value), allowed(saved), saved != url {
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
        launching = false
        if !showingFallback { webView.evaluateJavaScript(__SNAPSHOT_CHECK__, completionHandler: nil) }
        delegate.webView?(webView, didFinish: navigation)
    }

    private func failed(_ webView: WKWebView, error: Error) {
        let error = error as NSError
        // Policy cancellations, including our snapshot retry, are not load failures.
        guard !(error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled),
              !(error.domain == "WebKitErrorDomain" && error.code == 102) else { return }
        let url = (error.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url ?? serverURL
        guard allowed(url) else { return }
        if restoreSnapshot(webView, failed: url) { return }
        guard !showingFallback else { return }
        showingFallback = true
        launching = false
        let retry = url.absoluteString.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        // WKURLSchemeHandler cannot serve HTTPS. This packaged document retains
        // the allowed base origin and requires neither a worker nor any network.
        webView.loadHTMLString(__OFFLINE_HTML__.replacingOccurrences(of: "%RADICAL_RETRY_URL%", with: retry), baseURL: url)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(webView, error: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(webView, error: error)
    }

    // Forward every remaining optional callback to Capacitor.
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || delegate.responds(to: selector)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        delegate.responds(to: selector) ? delegate : super.forwardingTarget(for: selector)
    }
}
