import Capacitor
import UIKit

// The controller owns bars only. The bridge and its one WebView never change parents.
@available(iOS 18.0, *)
final class RadicalTabController: UITabBarController, UITabBarControllerDelegate {
    private let content = RadicalViewController()
    private let viewport = UIView()
    private var navigationHidden = false

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
        viewport.clipsToBounds = true
        view.addSubview(viewport)
        viewport.addSubview(content.view)
        content.didMove(toParent: self)
        sidebar.isHidden = false
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
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
        // Keep a window-sized web viewport. Clip it to UIKit's content region and
        // publish the bar space as safe area, rather than shrinking CSS dimensions.
        viewport.frame = frame
        let bounds = view.bounds
        content.view.frame = CGRect(x: -frame.minX, y: -frame.minY, width: bounds.width, height: bounds.height)
        let safe = view.safeAreaInsets
        let required = UIEdgeInsets(top: max(safe.top, frame.minY), left: max(safe.left, frame.minX),
            bottom: max(safe.bottom, bounds.maxY - frame.maxY), right: max(safe.right, bounds.maxX - frame.maxX))
        content.setNavigationSafeArea(required)
        view.bringSubviewToFront(viewport)
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
