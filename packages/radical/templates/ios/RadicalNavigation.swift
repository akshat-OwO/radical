import Capacitor
import UIKit

// The controller owns bars only. The bridge and its one WebView never change parents.
@available(iOS 18.0, *)
final class RadicalTabController: UITabBarController, UITabBarControllerDelegate {
    private let content = RadicalViewController()
    private let viewport = UIView()
    private var navigationHidden = false
    private var sidebarPlaced = false

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        mode = .tabSidebar
        sidebar.preferredLayout = .tile
        if #available(iOS 27.0, *) { sidebar.preferredPlacement = .sidebar }
        tabs = [__SECTIONS__]
        updateImages()
        content.navigationHost = self
        addChild(content)
        view.backgroundColor = .systemBackground
        view.addSubview(viewport)
        viewport.addSubview(content.view)
        content.didMove(toParent: self)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Open the sidebar at launch only where it tiles beside the page. Narrower
        // windows keep UIKit's tab bar, since an open overlay sidebar dims the page.
        if !sidebarPlaced, view.window != nil {
            sidebarPlaced = true
            if traitCollection.horizontalSizeClass == .regular && view.bounds.width > view.bounds.height {
                sidebar.isHidden = false
            }
        }
        // iOS 26's guide also follows vertical bars on the Duo. On iOS 18,
        // the selected placeholder's safe area describes the unobscured region.
        let frame: CGRect
        if #available(iOS 26.0, *) {
            frame = contentLayoutGuide.layoutFrame
        } else if let selected = selectedViewController, selected !== content {
            frame = selected.view.convert(selected.view.safeAreaLayoutGuide.layoutFrame, to: view)
        } else {
            frame = view.safeAreaLayoutGuide.layoutFrame
        }
        // The page draws edge to edge, under the status bar and behind the bars,
        // and lays out inside UIKit's content region through safe area.
        let bounds = view.bounds
        let safe = view.safeAreaInsets
        let required = UIEdgeInsets(top: max(safe.top, frame.minY), left: max(safe.left, frame.minX),
            bottom: max(safe.bottom, bounds.maxY - frame.maxY), right: max(safe.right, bounds.maxX - frame.maxX))
        // Keep the WebView's window-sized coordinate space and CSS safe area,
        // but clip its viewport beside tiled bars so page motion cannot cross them.
        let left = required.left > safe.left ? required.left : 0
        let right = required.right > safe.right ? required.right : 0
        let page = CGRect(x: left, y: 0, width: bounds.width - left - right, height: bounds.height)
        content.navigationPageFrame = page
        viewport.frame = page
        viewport.clipsToBounds = true
        content.view.frame = bounds.offsetBy(dx: -left, dy: 0)
        content.setNavigationSafeArea(required)
        placeViewport()
    }

    // Sit directly above the tab content container, so the page covers the empty
    // placeholder tabs and receives their touches while the bars stay on top.
    private func placeViewport() {
        guard var container = selectedViewController?.view else {
            view.sendSubviewToBack(viewport)
            return
        }
        while let parent = container.superview, parent !== view { container = parent }
        guard container.superview === view, container !== viewport else { return }
        let subviews = view.subviews
        guard let containerIndex = subviews.firstIndex(of: container),
              subviews.firstIndex(of: viewport) != containerIndex + 1 else { return }
        view.insertSubview(viewport, aboveSubview: container)
    }

    private func updateImages() {
        for tab in tabs {
            guard let symbols = tab.userInfo as? [String: String],
                  let name = symbols[tab === selectedTab ? "selectedIcon" : "icon"] else { continue }
            tab.image = UIImage(systemName: name)
        }
    }

    func update(_ state: [AnyHashable: Any]) {
        guard let hidden = state["hidden"] as? Bool,
              let entries = state["sections"] as? [[String: Any]] else { return }
        if let active = state["active"] as? [String: Any], let id = active["id"] as? String,
           let tab = tabs.first(where: { $0.identifier == id }), selectedTab !== tab {
            // Programmatic selection never emits a selection intent.
            UIView.performWithoutAnimation { selectedTab = tab }
            updateImages()
        }
        for entry in entries {
            guard let id = entry["id"] as? String, let tab = tabs.first(where: { $0.identifier == id }) else { continue }
            if let value = entry["badge"] as? String { tab.badgeValue = value }
            else if let value = entry["badge"] as? NSNumber { tab.badgeValue = value.stringValue }
            else { tab.badgeValue = nil }
        }
        if navigationHidden != hidden {
            navigationHidden = hidden
            if hidden { sidebar.isHidden = true }
            mode = hidden ? .tabBar : .tabSidebar
            setTabBarHidden(hidden, animated: false)
            if !hidden { sidebar.isHidden = false }
            view.setNeedsLayout()
        }
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelectTab tab: UITab) -> Bool {
        // Intents are deliberately not retained. The adapter owns routing and memory,
        // including reselecting the current section to return to its root.
        let data = try! JSONSerialization.data(withJSONObject: ["id": tab.identifier])
        let payload = String(data: data, encoding: .utf8)!
        content.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('radicalSectionSelect',{detail:" + payload + "}));", completionHandler: nil)
        return false
    }
}

@objc(RadicalNavigationPlugin)
public final class RadicalNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalNavigationPlugin"
    public let jsName = "RadicalNavigation"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)]

    @objc public func update(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 18.0, *), let controller = self.bridge?.viewController as? RadicalViewController {
                controller.navigationHost?.update(call.options)
            }
            call.resolve()
        }
    }
}
