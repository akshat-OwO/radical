import Capacitor
import CoreLocation
import UIKit

@objc(RadicalLocationPlugin)
public class RadicalLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "RadicalLocationPlugin"
    public let jsName = "RadicalLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playServicesAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "accuracyAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestTemporaryFullAccuracy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openLocationServicesSettings", returnType: CAPPluginReturnPromise)
    ]
    private let manager = CLLocationManager()
    private var observers: [NSObjectProtocol] = []
    private var permissionCalls: [CAPPluginCall] = []
    public override func load() {
        manager.delegate = self
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.notifyListeners("appStateChange", data: ["active": false], retainUntilConsumed: true) })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.notifyListeners("appStateChange", data: ["active": true], retainUntilConsumed: true) })
    }
    deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }
    private func result() -> [String: Any] { ["precision": manager.accuracyAuthorization == .fullAccuracy ? "precise" : "approximate"] }
    private func permissionResult() -> [String: Any] {
        let state: String
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: state = "granted"
        case .restricted, .denied: state = "denied"
        default: state = "prompt"
        }
        return ["location": state, "coarseLocation": state]
    }
    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.permissionResult()) }
    }
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.manager.authorizationStatus == .notDetermined else {
                call.resolve(self.permissionResult()); return
            }
            self.permissionCalls.append(call)
            if self.permissionCalls.count == 1 { self.manager.requestWhenInUseAuthorization() }
        }
    }
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined else { return }
        let calls = permissionCalls
        permissionCalls.removeAll()
        for call in calls { call.resolve(permissionResult()) }
    }
    @objc public func playServicesAvailability(_ call: CAPPluginCall) {
        call.resolve(["available": false])
    }
    @objc public func accuracyAuthorization(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.result()) }
    }
    @objc public func requestTemporaryFullAccuracy(_ call: CAPPluginCall) {
        guard let key = call.getString("purposeKey"), let purposes = Bundle.main.object(forInfoDictionaryKey: "NSLocationTemporaryUsageDescriptionDictionary") as? [String: String], purposes[key] != nil else {
            call.reject("Configure the precise purpose key in pluginOptions.Location.precisePurposes"); return
        }
        DispatchQueue.main.async {
            // CoreLocation returns an error instead of prompting when full accuracy is already granted.
            if self.manager.accuracyAuthorization == .fullAccuracy { call.resolve(self.result()); return }
            self.manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: key) { error in
                if let error = error { call.reject("Cannot request precise location", nil, error) }
                else { call.resolve(self.result()) }
            }
        }
    }
    @objc public func openLocationServicesSettings(_ call: CAPPluginCall) {
        // iOS has no public URL for the device-wide Location Services screen.
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("Settings unavailable"); return }
            UIApplication.shared.open(url) { opened in
                if opened { call.resolve() } else { call.reject("Settings unavailable") }
            }
        }
    }
}
