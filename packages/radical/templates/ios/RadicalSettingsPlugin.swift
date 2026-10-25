import Capacitor
import UIKit

@objc(RadicalSettingsPlugin)
public class RadicalSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalSettingsPlugin"
    public let jsName = "RadicalSettings"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)]
    @objc public func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("Settings unavailable"); return }
            UIApplication.shared.open(url) { opened in
                if opened { call.resolve() } else { call.reject("Settings unavailable") }
            }
        }
    }
}
