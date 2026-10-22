import Capacitor
import FirebaseCore
import FirebaseMessaging

@objc(RadicalNotificationTopicsPlugin)
public class RadicalNotificationTopicsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalNotificationTopicsPlugin"
    public let jsName = "RadicalNotificationTopics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "subscribe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unsubscribe", returnType: CAPPluginReturnPromise)
    ]
    private let key = "radical.notificationTopics"
    @objc func status(_ call: CAPPluginCall) { call.resolve(["configured": FirebaseApp.app() != nil]) }
    @objc func list(_ call: CAPPluginCall) { call.resolve(["topics": UserDefaults.standard.stringArray(forKey: key) ?? []]) }
    @objc func subscribe(_ call: CAPPluginCall) { update(call, subscribe: true) }
    @objc func unsubscribe(_ call: CAPPluginCall) { update(call, subscribe: false) }
    private func update(_ call: CAPPluginCall, subscribe: Bool) {
        guard FirebaseApp.app() != nil else { call.reject("Firebase configuration is missing", "MissingPushConfiguration"); return }
        guard let topic = call.getString("topic"), topic.range(of: "^[a-zA-Z0-9_.~%\\-]{1,900}$", options: .regularExpression) != nil else { call.reject("Invalid topic"); return }
        let complete: (Error?) -> Void = { error in
            DispatchQueue.main.async {
                if let error = error { call.reject(error.localizedDescription); return }
                var topics = Set(UserDefaults.standard.stringArray(forKey: self.key) ?? [])
                if subscribe { topics.insert(topic) } else { topics.remove(topic) }
                UserDefaults.standard.set(Array(topics).sorted(), forKey: self.key)
                call.resolve()
            }
        }
        if subscribe { Messaging.messaging().subscribe(toTopic: topic, completion: complete) }
        else { Messaging.messaging().unsubscribe(fromTopic: topic, completion: complete) }
    }
}
