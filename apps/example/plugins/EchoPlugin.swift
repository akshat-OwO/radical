import Capacitor

@objc(EchoPlugin)
public class EchoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EchoPlugin"
    public let jsName = "Echo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "echo", returnType: CAPPluginReturnPromise)
    ]
    @objc public func echo(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        if text == "deny" {
            call.reject("Rejected", "EchoRejected", nil, ["reason": "The example rejected this input"])
            return
        }
        call.resolve(["text": (getConfig().getString("prefix") ?? "") + text])
    }
}
