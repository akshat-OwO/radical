import Capacitor
import WebKit

// Remote mode uses WebKit's networking and persistent cookie store.
// App-Bound Domains and service-worker support belong to issue #10.
final class RadicalViewController: CAPBridgeViewController {
    private var navigationProxy: RadicalNavigationDelegate?

    override func viewDidLoad() {
        guard let webView = webView, let delegate = webView.navigationDelegate else { fatalError("Radical requires Capacitor WebView and navigation delegate before viewDidLoad") }
        let origins: Set<String> = [__ORIGINS__]
        let proxy = RadicalNavigationDelegate(delegate: delegate, origins: origins)
        navigationProxy = proxy
        webView.navigationDelegate = proxy
        let group = DispatchGroup()
        for (hostname, origin, secure) in [__COOKIES__] {
            guard let url = URL(string: origin) else { fatalError("Radical generated an invalid cookie origin") }
            var properties: [HTTPCookiePropertyKey: Any] = [
                .originURL: url,
                .domain: hostname,
                .path: "/",
                .name: __COOKIE_NAME__,
                .value: __COOKIE_VALUE__,
                HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax
            ]
            if secure { properties[.secure] = "TRUE" }
            guard let cookie = HTTPCookie(properties: properties) else { fatalError("Radical could not construct the native context cookie") }
            group.enter()
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { super.viewDidLoad() }
    }
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
