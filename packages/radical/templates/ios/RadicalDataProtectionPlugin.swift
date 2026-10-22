import Capacitor
import UIKit
import WebKit

@objc(RadicalDataProtectionPlugin)
public class RadicalDataProtectionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalDataProtectionPlugin"
    public let jsName = "RadicalDataProtection"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setProtection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearWebData", returnType: CAPPluginReturnPromise)
    ]
    private var enabled = false
    private var inactive = false
    private var cover: UIView?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        // UIKit posts lifecycle and capture notifications on the main thread.
        // Apply the cover before the notification returns and UIKit snapshots the window.
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.inactive = true
            self?.updateCover()
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.inactive = false
            self?.updateCover()
        })
        observers.append(center.addObserver(forName: UIScreen.capturedDidChangeNotification, object: nil, queue: nil) { [weak self] _ in
            self?.updateCover()
        })
    }
    deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }

    private func updateCover() {
        guard let window = bridge?.webView?.window else { return }
        let captured = window.screen.isCaptured
        if enabled && (inactive || captured) {
            if cover == nil {
                let view = UIView(frame: window.bounds)
                view.backgroundColor = .black
                view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                window.addSubview(view)
                cover = view
            }
            if let cover = cover { window.bringSubviewToFront(cover) }
        } else { cover?.removeFromSuperview(); cover = nil }
    }

    @objc public func setProtection(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let enabled = call.getBool("enabled"), let window = self.bridge?.webView?.window else {
                call.reject("No visible WebView or missing enabled"); return
            }
            self.enabled = enabled
            self.inactive = window.windowScene?.activationState != .foregroundActive
            self.updateCover()
            // iOS has no public screenshot blocking API. Capture obscuring is reactive.
            call.resolve(["enabled": enabled, "screenshots": false, "recording": enabled, "appSwitcher": enabled])
        }
    }

    @objc public func clearWebData(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.bridge?.webView else { call.reject("No WebView"); return }
            if let transitions = self.bridge?.plugin(withName: "RadicalTransitions") {
                let clearData = NSSelectorFromString("clearData")
                if transitions.responds(to: clearData) { transitions.perform(clearData) }
            }
            UserDefaults.standard.removeObject(forKey: __OFFLINE_SAVED_URL_KEY__)
            UserDefaults.standard.removeObject(forKey: "radical.notificationTopics")
            URLCache.shared.removeAllCachedResponses()
            HTTPCookieStorage.shared.removeCookies(since: .distantPast)
            webView.configuration.websiteDataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                DispatchQueue.global(qos: .utility).async {
                    do {
                        let manager = FileManager.default
                        let directories = manager.urls(for: .cachesDirectory, in: .userDomainMask) + [manager.temporaryDirectory]
                        for directory in directories {
                            for file in try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
                                try manager.removeItem(at: file)
                            }
                        }
                        call.resolve()
                    } catch { call.reject("Cannot clear native caches", nil, error) }
                }
            }
        }
    }
}
