import Darwin
import Capacitor
import CoreLocation
import UIKit
import UserNotifications

// All owner state, delegate callbacks and command completions belong to the main queue.
// Plugin destruction only removes observation, never acquisition.
private final class RadicalTrackingOwner: NSObject, CLLocationManagerDelegate {
    static let shared = RadicalTrackingOwner()
    private let manager = CLLocationManager()
    private var hydrated = false
    private var unresolvedRecovery = false
    private var revision = 0
    private(set) var session: [String: Any]?
    var observers: [UUID: ([String: Any]) -> Void] = [:]
    private var acquiring = false
    private var timeout: DispatchWorkItem?
    private var publication: DispatchWorkItem?
    private var pendingFix: [String: Any]?
    private var lastPublished = Date.distantPast
    private var services = true
    private var notifications = "denied"
    private var commands: [(CAPPluginCall, String)] = []
    private var checking = false
    private var generation = 0
    private var resumeObserver: NSObjectProtocol?

    override private init() {
        super.init()
        manager.delegate = self
        resumeObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            self.refresh()
        }
    }
    private var active: Bool {
        let state = (session?["status"] as? [String: String])?["state"]
        return state == "running" || state == "suspended"
    }
    private var granted: Bool {
        manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse
    }
    private func permission() -> [String: String] {
        let state = granted ? "granted" : manager.authorizationStatus == .notDetermined ? "prompt" : "denied"
        return ["state": state, "precision": granted ? manager.accuracyAuthorization == .fullAccuracy ? "precise" : "approximate" : "unknown"]
    }
    private func metadataURL() throws -> URL {
        let fm = FileManager.default
        var directory = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("RadicalTracking", isDirectory: true)
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
            throw NSError(domain: "RadicalTracking", code: 1)
        }
        return directory.appendingPathComponent("session.json")
    }
    private func persist(_ value: [String: Any], pendingAuthorization: Bool = false) throws {
        let state = value["status"] as? [String: String] ?? [:]
        let terminal = state["state"] == "stopped" || state["state"] == "interrupted"
        let record: [String: Any] = ["id": value["id"]!, "options": value["options"]!, "startedAt": value["startedAt"]!, "terminalState": terminal ? state : NSNull(),
            // A provisional termination must resolve authorization after services return, even across launches.
            "pendingAuthorization": pendingAuthorization]
        let url = try metadataURL()
        var temporary = url.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try JSONSerialization.data(withJSONObject: record).write(to: temporary)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try temporary.setResourceValues(values)
        guard try temporary.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
            throw NSError(domain: "RadicalTracking", code: 2)
        }
        // Same-directory rename is the commit point. No fallible work follows it.
        guard rename(temporary.path, url.path) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
    }

    private func hydrate() throws {
        if hydrated { return }
        let url = try metadataURL()
        if !FileManager.default.fileExists(atPath: url.path) { hydrated = true; return }
        guard let record = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
              let id = record["id"] as? String, let options = record["options"] as? [String: Any],
              let started = record["startedAt"] as? Double else { throw NSError(domain: "RadicalTracking", code: 3) }
        let terminal = record["terminalState"] as? [String: String]
        // Services off masks app authorization. Resolve revocation only when services return.
        let pending = terminal == nil || record["pendingAuthorization"] as? Bool == true
        let unresolved = pending && (!services || manager.authorizationStatus == .notDetermined)
        let status = !pending ? terminal! : (services && manager.authorizationStatus == .denied
            ? ["state": "stopped", "reason": "permissionRevoked"]
            : ["state": "interrupted", "reason": "termination"])
        let candidate: [String: Any] = ["id": id, "options": options, "startedAt": started, "status": status,
            "latest": NSNull(), "lastError": NSNull(), "permission": permission(), "notifications": ["state": notifications]]
        if pending { try persist(candidate, pendingAuthorization: unresolved) }
        unresolvedRecovery = unresolved
        session = candidate
        publish()
        hydrated = true
    }
    private func publish() {
        guard session != nil else { return }
        revision += 1
        session?["revision"] = revision
        let value = session!
        for receive in Array(observers.values) { receive(value) }
    }
    func enqueue(_ call: CAPPluginCall, _ method: String) {
        commands.append((call, method))
        refresh()
    }
    func refresh() {
        generation += 1
        guard !checking else { return }
        let sampleGeneration = generation
        checking = true
        // This synchronous Core Location query can block, so never run it on main.
        DispatchQueue.global(qos: .utility).async {
            let enabled = CLLocationManager.locationServicesEnabled()
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
                DispatchQueue.main.async {
                    self.checking = false
                    guard sampleGeneration == self.generation else { self.refresh(); return }
                    self.services = enabled
                    self.notifications = allowed ? "granted" : "denied"
                    self.checking = false
                    let calls = self.commands
                    self.commands.removeAll()
                    do {
                        try self.hydrate()
                        try self.reconcile()
                        for (call, method) in calls { self.execute(call, method) }
                    } catch {
                        for (call, _) in calls { self.fail(call, "Unavailable", ["reason": String(describing: error)]) }
                        if calls.isEmpty && self.session != nil {
                            self.session?["lastError"] = ["_tag": "Unavailable", "reason": String(describing: error)]
                            self.publish()
                        }
                    }
                }
            }
        }
    }
    private func fail(_ call: CAPPluginCall, _ code: String, _ data: [String: Any] = [:]) {
        call.reject(code, code, nil, data)
    }
    private func execute(_ call: CAPPluginCall, _ method: String) {
        do {
            if method == "get" { call.resolve(["session": session as Any? ?? NSNull()]); return }
            if method == "stop" {
                let id = call.getString("id") ?? ""
                guard session?["id"] as? String == id else { fail(call, "TrackingSessionNotFound", ["id": id]); return }
                if active { try terminate("user") }
                call.resolve(session!); return
            }
            if active { fail(call, "TrackingSessionAlreadyActive", ["id": session!["id"]!]); return }
            guard UIApplication.shared.applicationState == .active else { fail(call, "TrackingStartRequiresForeground"); return }
            guard services else { fail(call, "LocationServicesOff"); return }
            guard granted else { fail(call, "PermissionDenied"); return }
            let preset = call.getString("preset") ?? ""
            let interval = call.getDouble("interval")
            let distance = call.getDouble("minimumDistance")
            guard ["balanced", "fitness", "navigation"].contains(preset),
                  interval == nil || (interval!.isFinite && interval! > 0),
                  distance == nil || (distance!.isFinite && distance! >= 0) else {
                fail(call, "InvalidTrackingOptions", ["message": "Invalid preset, interval or minimumDistance"]); return
            }
            var options: [String: Any] = ["preset": preset]
            if let interval = interval { options["interval"] = interval }
            if let distance = distance { options["minimumDistance"] = distance }
            let candidate: [String: Any] = ["id": UUID().uuidString, "startedAt": Date().timeIntervalSince1970 * 1000,
                "options": options, "status": ["state": "running"], "latest": NSNull(), "lastError": NSNull(),
                "permission": permission(), "notifications": ["state": notifications]]
            try persist(candidate)
            unresolvedRecovery = false
            session = candidate
            manager.desiredAccuracy = preset == "balanced" ? kCLLocationAccuracyHundredMeters : preset == "fitness" ? kCLLocationAccuracyBest : kCLLocationAccuracyBestForNavigation
            manager.activityType = preset == "fitness" ? .fitness : preset == "navigation" ? .automotiveNavigation : .other
            manager.distanceFilter = distance ?? (preset == "balanced" ? 50 : preset == "fitness" ? 5 : kCLDistanceFilterNone)
            manager.allowsBackgroundLocationUpdates = true
            manager.pausesLocationUpdatesAutomatically = false
            manager.showsBackgroundLocationIndicator = true
            lastPublished = .distantPast
            acquiring = true
            manager.startUpdatingLocation()
            armTimeout()
            publish()
            call.resolve(session!)
        } catch { fail(call, "Unavailable", ["reason": String(describing: error)]) }
    }
    private func terminate(_ reason: String) throws {
        guard var candidate = session else { return }
        candidate["status"] = ["state": "stopped", "reason": reason]
        if let fix = pendingFix { candidate["latest"] = fix }
        try persist(candidate)
        session = candidate
        acquiring = false
        manager.stopUpdatingLocation()
        timeout?.cancel()
        publication?.cancel()
        publication = nil
        pendingFix = nil
        publish()
    }
    private func reconcile() throws {
        guard session != nil else { return }
        let previous = NSDictionary(dictionary: session!)
        session?["permission"] = permission()
        session?["notifications"] = ["state": notifications]
        if unresolvedRecovery && services && manager.authorizationStatus != .notDetermined {
            var candidate = session!
            if manager.authorizationStatus == .denied {
                candidate["status"] = ["state": "stopped", "reason": "permissionRevoked"]
            }
            try persist(candidate)
            session = candidate
            unresolvedRecovery = false
            publish()
        }
        if active {
            if !services {
                session?["status"] = ["state": "suspended", "reason": "servicesOff"]
                session?["lastError"] = ["_tag": "LocationServicesOff"]
                timeout?.cancel()
                publication?.cancel()
                publication = nil
                if let fix = pendingFix { session?["latest"] = fix }
                pendingFix = nil
            } else if manager.authorizationStatus == .denied {
                try terminate("permissionRevoked")
                return
            } else {
                let suspended = (session?["status"] as? [String: String])?["state"] == "suspended"
                session?["status"] = ["state": "running"]
                if suspended { session?["lastError"] = NSNull(); armTimeout() }
            }
        }
        if !previous.isEqual(to: session!) { publish() }
    }
    private func armTimeout() {
        timeout?.cancel()
        let task = DispatchWorkItem {
            guard self.active, self.services else { return }
            self.session?["lastError"] = ["_tag": "LocationTimeout"]
            self.publish()
        }
        timeout = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: task)
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { refresh() }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        refresh()
        if let error = error as? CLError, error.code == .locationUnknown, active {
            session?["lastError"] = ["_tag": "LocationTimeout"]
            publish()
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard acquiring, active, services, granted, let fix = locations.last, fix.horizontalAccuracy >= 0 else { return }
        pendingFix = ["latitude": fix.coordinate.latitude, "longitude": fix.coordinate.longitude, "accuracy": fix.horizontalAccuracy,
            "timestamp": fix.timestamp.timeIntervalSince1970 * 1000,
            "altitude": fix.verticalAccuracy >= 0 ? fix.altitude : NSNull(),
            "altitudeAccuracy": fix.verticalAccuracy >= 0 ? fix.verticalAccuracy : NSNull(),
            "heading": fix.course >= 0 ? fix.course : NSNull(), "speed": fix.speed >= 0 ? fix.speed : NSNull()]
        session?["lastError"] = NSNull()
        armTimeout()
        guard publication == nil else { return }
        let options = session?["options"] as? [String: Any]
        let interval = (options?["interval"] as? Double ?? 0) / 1000
        let delay = max(0, interval - Date().timeIntervalSince(lastPublished))
        if delay == 0 { flushFix(); return }
        let task = DispatchWorkItem { self.publication = nil; self.flushFix() }
        publication = task
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: task)
    }
    private func flushFix() {
        guard active, services, let fix = pendingFix else { return }
        session?["latest"] = fix
        pendingFix = nil
        lastPublished = Date()
        publish()
    }
}

@objc(RadicalTrackingSessionPlugin)
public class RadicalTrackingSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadicalTrackingSessionPlugin"
    public let jsName = "RadicalTrackingSession"
    public let pluginMethods = [
        CAPPluginMethod(name: "startTrackingSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTrackingSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTrackingSession", returnType: CAPPluginReturnPromise)
    ]
    private let token = UUID()
    private var resumeObserver: NSObjectProtocol?
    public override func load() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            RadicalTrackingOwner.shared.observers[self.token] = { [weak self] value in
                self?.notifyListeners("trackingSessionChange", data: ["sessionId": value["id"]!, "revision": value["revision"]!, "session": value])
            }
            self.resumeObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.notifyListeners("appStateChange", data: ["active": true])
            }
            RadicalTrackingOwner.shared.refresh()
        }
    }
    deinit {
        if let observer = resumeObserver { NotificationCenter.default.removeObserver(observer) }
        let token = token
        DispatchQueue.main.async { RadicalTrackingOwner.shared.observers.removeValue(forKey: token) }
    }
    @objc public func startTrackingSession(_ call: CAPPluginCall) { DispatchQueue.main.async { RadicalTrackingOwner.shared.enqueue(call, "start") } }
    @objc public func getTrackingSession(_ call: CAPPluginCall) { DispatchQueue.main.async { RadicalTrackingOwner.shared.enqueue(call, "get") } }
    @objc public func stopTrackingSession(_ call: CAPPluginCall) { DispatchQueue.main.async { RadicalTrackingOwner.shared.enqueue(call, "stop") } }
}
