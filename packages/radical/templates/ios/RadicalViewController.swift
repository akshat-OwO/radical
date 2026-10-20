import Capacitor
import WebKit

// Remote mode uses WebKit's networking and persistent cookie store.
// App-Bound Domains and service-worker support belong to issue #10.
final class RadicalViewController: CAPBridgeViewController {
    private var navigationProxy: RadicalNavigationDelegate?

    private var started = false
    private var writing = false
    private var laidOut = false
    private var lastInsets: UIEdgeInsets?
    private var safeAreaScript: WKUserScript?

    override func viewDidLoad() {
        // Delay Capacitor's initial navigation until window layout and cookies are ready.
        guard let webView = webView, let delegate = webView.navigationDelegate else { fatalError("Radical requires Capacitor WebView") }
        let proxy = RadicalNavigationDelegate(delegate: delegate, origins: [__ORIGINS__])
        navigationProxy = proxy
        webView.navigationDelegate = proxy
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
final class RadicalNavigationDelegate: NSObject, WKNavigationDelegate {
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
        if delegate.webView?(webView, decidePolicyFor: action, decisionHandler: decisionHandler) == nil {
            decisionHandler(.allow)
        }
    }

    // Capacitor 8.5.3 implements only the action-policy variant above.
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || delegate.responds(to: selector)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        delegate.responds(to: selector) ? delegate : super.forwardingTarget(for: selector)
    }
}
