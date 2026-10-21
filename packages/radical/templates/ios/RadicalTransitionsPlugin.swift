import Capacitor
import WebKit
@objc(RadicalTransitionsPlugin)
public class RadicalTransitionsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalTransitionsPlugin"
    public let jsName = "RadicalTransitions"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "cover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reveal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]
    private var overlay: UIView?
    private weak var movingContent: UIView?
    private var shade: UIView?
    private var overlayID: String?
    private var expiry: DispatchWorkItem?

    private func clear(_ id: String) {
        guard overlayID == id else { return }
        // Invalidate before cancelling animations, whose completion can re-enter cleanup.
        overlayID = nil
        expiry?.cancel()
        expiry = nil
        movingContent?.layer.removeAllAnimations()
        movingContent?.transform = .identity
        movingContent = nil
        shade?.removeFromSuperview()
        shade = nil
        overlay?.layer.removeAllAnimations()
        overlay?.removeFromSuperview()
        overlay = nil
    }

    @objc public func cover(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let id = call.getString("id"),
                  let webView = self.bridge?.webView, let window = webView.window else {
                call.reject("No visible WebView"); return
            }
            if let current = self.overlayID { self.clear(current) }
            // Window capture includes edge-to-edge content, safe areas and system bars.
            guard let snapshot = window.snapshotView(afterScreenUpdates: false) else {
                call.reject("Cannot snapshot window"); return
            }
            snapshot.frame = window.bounds
            snapshot.isUserInteractionEnabled = false
            window.addSubview(snapshot)
            self.overlay = snapshot
            self.overlayID = id
            let expiry = DispatchWorkItem { [weak self] in self?.clear(id) }
            self.expiry = expiry
            DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: expiry)
            // The overlay is attached before JavaScript can commit the new route.
            call.resolve(["id": id])
        }
    }

    @objc public func reveal(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let id = call.getString("id") else { call.reject("Missing id"); return }
            guard self.overlayID == id, let webView = self.bridge?.webView else { call.resolve(["id": id]); return }
            // After JS's paint frames, wait for WebKit to produce the new contents.
            webView.takeSnapshot(with: nil) { [weak self] image, error in
                guard let self = self, self.overlayID == id, let overlay = self.overlay else { call.resolve(["id": id]); return }
                guard error == nil, image != nil else { self.clear(id); call.reject("Paint snapshot failed"); return }
                let reduced = UIAccessibility.isReduceMotionEnabled || call.getBool("reducedMotion") == true
                if reduced { self.clear(id); call.resolve(["id": id]); return }
                let slide = call.getString("kind") == "slide"
                let back = call.getString("direction") == "back"
                let width = overlay.bounds.width
                var content: UIView = webView
                if slide {
                    guard let window = overlay.superview else { self.clear(id); call.reject("No transition window"); return }
                    while let parent = content.superview, parent !== window { content = parent }
                    guard content.superview === window else { self.clear(id); call.reject("No common transition parent"); return }
                    self.movingContent = content
                    let shade = UIView(frame: back ? content.bounds : overlay.bounds)
                    shade.backgroundColor = .black
                    shade.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                    shade.alpha = back ? 0.12 : 0
                    shade.isUserInteractionEnabled = false
                    if back { content.addSubview(shade) }
                    else { overlay.addSubview(shade) }
                    self.shade = shade
                    // Set offsets and stacking together before Core Animation presents a frame.
                    UIView.performWithoutAnimation {
                        content.transform = CGAffineTransform(translationX: back ? -0.3 * width : width, y: 0)
                        if !back { window.insertSubview(overlay, belowSubview: content) }
                    }
                }
                UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseOut], animations: {
                    if slide {
                        content.transform = .identity
                        overlay.transform = CGAffineTransform(translationX: back ? width : -0.3 * width, y: 0)
                        self.shade?.alpha = back ? 0 : 0.12
                    } else { overlay.alpha = 0 }
                }, completion: { [weak self] _ in
                    self?.clear(id)
                    call.resolve(["id": id])
                })
            }
        }
    }

    @objc public func remove(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let id = call.getString("id") else { call.reject("Missing id"); return }
            self?.clear(id)
            call.resolve(["id": id])
        }
    }

    deinit {
        expiry?.cancel()
        let captured = overlay
        let content = movingContent
        let dimming = shade
        DispatchQueue.main.async {
            content?.layer.removeAllAnimations()
            content?.transform = .identity
            dimming?.removeFromSuperview()
            captured?.removeFromSuperview()
        }
    }
}
