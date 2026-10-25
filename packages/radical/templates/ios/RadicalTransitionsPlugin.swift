import Capacitor
import WebKit
@objc(RadicalTransitionsPlugin)
public class RadicalTransitionsPlugin: CAPPlugin, CAPBridgedPlugin, UIGestureRecognizerDelegate {
    public let identifier = "RadicalTransitionsPlugin"
    public let jsName = "RadicalTransitions"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "cover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reveal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "settle", returnType: CAPPluginReturnPromise)
    ]
    // Window snapshots of pages left by forward transitions, by history index.
    private static let retainedDepth = 5
    private var retained: [Int: UIView] = [:]
    private var backPop = false
    private var backIndex = 0
    private var edgePan: UIPanGestureRecognizer?
    // WebKit claims screen-edge recognizers, so this pan filters edge touches itself.
    private static let edgeWidth: CGFloat = 24
    private var swipe: (content: UIView, snapshot: UIView?, shade: UIView?)?
    private var swipeExpiry: DispatchWorkItem?
    private var overlay: UIView?
    private weak var movingContent: UIView?
    private var shade: UIView?
    private var overlayID: String?
    private var expiry: DispatchWorkItem?

    @objc public func clearData() { if let id = overlayID { clear(id) } }

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
                    guard let self = self else { return }
                    if !back, let index = call.getInt("index"), self.overlayID == id, let kept = self.overlay {
                        // Keep the page that was left so an edge swipe can reveal it.
                        self.overlay = nil
                        kept.removeFromSuperview()
                        kept.transform = .identity
                        kept.alpha = 1
                        self.shade?.removeFromSuperview()
                        self.shade = nil
                        self.retain(kept, at: index)
                    }
                    self.clear(id)
                    call.resolve(["id": id])
                })
            }
        }
    }

    private func retain(_ snapshot: UIView, at index: Int) {
        for key in retained.keys where key >= index { retained.removeValue(forKey: key) }
        retained[index] = snapshot
        while retained.count > Self.retainedDepth, let oldest = retained.keys.min() {
            retained.removeValue(forKey: oldest)
        }
    }

    @objc public func setBack(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.backPop = call.getBool("pop") ?? false
            self.backIndex = call.getInt("index") ?? 0
            // Snapshots at or above the live page describe pages no longer behind it.
            for key in self.retained.keys where key >= self.backIndex { self.retained.removeValue(forKey: key) }
            self.installEdgePan()
            call.resolve()
        }
    }

    // iOS has no system back to hand over to.
    @objc public func exit(_ call: CAPPluginCall) { call.resolve() }

    @objc public func settle(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.swipe != nil, let webView = self.bridge?.webView else { call.resolve(); return }
            // Wait for WebKit to produce the popped page before uncovering it.
            webView.takeSnapshot(with: nil) { [weak self] _, _ in
                self?.endSwipe()
                call.resolve()
            }
        }
    }

    private func installEdgePan() {
        guard edgePan == nil, let host = bridge?.viewController?.view else { return }
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleEdgePan(_:)))
        pan.delegate = self
        pan.maximumNumberOfTouches = 1
        host.addGestureRecognizer(pan)
        edgePan = pan
    }

    public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer === edgePan else { return true }
        return backPop && touch.location(in: nil).x <= Self.edgeWidth
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === edgePan, let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
        let velocity = pan.velocity(in: nil)
        return backPop && overlayID == nil && swipe == nil && velocity.x > abs(velocity.y)
    }

    // An edge swipe takes over from the page's own scrolling and taps.
    public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        gestureRecognizer === edgePan
    }

    private func movingContent(in window: UIWindow, from webView: UIView) -> UIView? {
        var content: UIView = webView
        while let parent = content.superview, parent !== window { content = parent }
        return content.superview === window ? content : nil
    }

    @objc private func handleEdgePan(_ pan: UIPanGestureRecognizer) {
        guard let webView = bridge?.webView, let window = webView.window else { return }
        let width = window.bounds.width
        let translation = max(0, pan.translation(in: window).x)
        let progress = min(1, translation / max(width, 1))
        switch pan.state {
        case .began:
            guard let content = movingContent(in: window, from: webView) else { return }
            guard let snapshot = retained[backIndex - 1] else {
                // Past the retained depth, release runs the reversed slide instead.
                swipe = (content, nil, nil)
                return
            }
            snapshot.frame = window.bounds
            snapshot.transform = CGAffineTransform(translationX: -0.3 * width, y: 0)
            let shade = UIView(frame: snapshot.bounds)
            shade.backgroundColor = .black
            shade.alpha = 0.12
            shade.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            shade.isUserInteractionEnabled = false
            snapshot.addSubview(shade)
            UIView.performWithoutAnimation { window.insertSubview(snapshot, belowSubview: content) }
            swipe = (content, snapshot, shade)
        case .changed:
            guard let swipe = swipe, let snapshot = swipe.snapshot else { return }
            swipe.content.transform = CGAffineTransform(translationX: translation, y: 0)
            snapshot.transform = CGAffineTransform(translationX: -0.3 * width * (1 - progress), y: 0)
            swipe.shade?.alpha = 0.12 * (1 - progress)
        case .ended, .cancelled, .failed:
            guard let swipe = swipe else { return }
            let velocity = pan.velocity(in: window).x
            let complete = pan.state == .ended && (progress > 0.35 || velocity > 600) && velocity > -200
            guard let snapshot = swipe.snapshot else {
                self.swipe = nil
                if complete { requestBack(interactive: false) }
                return
            }
            let remaining = complete ? 1 - progress : progress
            UIView.animate(withDuration: max(0.12, 0.3 * Double(remaining)), delay: 0, options: [.curveEaseOut, .beginFromCurrentState], animations: {
                swipe.content.transform = complete ? CGAffineTransform(translationX: width, y: 0) : .identity
                snapshot.transform = complete ? .identity : CGAffineTransform(translationX: -0.3 * width, y: 0)
                swipe.shade?.alpha = complete ? 0 : 0.12
            }, completion: { [weak self] _ in
                guard let self = self else { return }
                guard complete else { self.endSwipe(); return }
                // The popped page loads under the snapshot; `settle` uncovers it.
                let expiry = DispatchWorkItem { [weak self] in self?.endSwipe() }
                self.swipeExpiry = expiry
                DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: expiry)
                self.requestBack(interactive: true)
            })
        default:
            break
        }
    }

    private func requestBack(interactive: Bool) {
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('radicalBack',{detail:{interactive:" + (interactive ? "true" : "false") + "}}));", completionHandler: nil)
    }

    // Cancelled, settled, or expired swipes always restore the live page.
    private func endSwipe() {
        swipeExpiry?.cancel()
        swipeExpiry = nil
        guard let swipe = swipe else { return }
        self.swipe = nil
        swipe.content.layer.removeAllAnimations()
        swipe.content.transform = .identity
        swipe.shade?.removeFromSuperview()
        if let snapshot = swipe.snapshot {
            snapshot.layer.removeAllAnimations()
            snapshot.transform = .identity
            snapshot.removeFromSuperview()
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
        swipeExpiry?.cancel()
        let swiping = swipe
        DispatchQueue.main.async {
            swiping?.content.transform = .identity
            swiping?.snapshot?.removeFromSuperview()
        }
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
