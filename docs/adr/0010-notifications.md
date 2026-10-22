# 0010: Notification plugins and topic membership

Use Capacitor Local Notifications 8.3.1 for OS scheduling and permission, Capawesome Badge 8.0.4 for launcher badges, and Capacitor Firebase Messaging 8.5.2 for FCM tokens and push taps. Firebase Messaging provides topics on both platforms, whereas Capacitor Push Notifications alone would require a second Firebase integration. Keep Firebase opt-in so local reminders need no Firebase project. Enabling local or push notifications also registers Capacitor Network 8.0.1 from `@capacitor/network`, even when `internalPlugins.network` is false. Notification taps need its native network status to select snapshots.

FCM has no client API for listing subscriptions. A small native RadicalNotificationTopics plugin records successful subscriptions and unsubscriptions in installation-local persistent storage. Lookup means confirmed local membership, not an authoritative server query. Failed FCM operations leave the record unchanged. This trades server reconciliation for a useful offline lookup without adding a backend or shipping administrative credentials.

Browser reminders use the Notification API and an Effect clock. They last only while the page remains open. Validate payloads before bridge calls, reject external notification routes, and own navigation listeners in an app-wide scope. Offline taps and taps with unavailable network status check the route's exact-URL snapshot before adapter navigation. A failed status read never selects the connected branch. Firebase files remain app-owned and outside version control. Native generation copies explicitly configured files, wires APNs callbacks, and adds iOS push entitlements. Builds without those files compile but cannot verify tokens or topic delivery.

Notification restore uses `core/offline/offline-protocol.ts` to select only the configured app ID's snapshot caches across base paths and build versions. Its shared snapshot key preserves the exact query string and omits fragments, matching the worker and native snapshot checks.

## Build plan contributions

`notification-build.ts` sits beside the notification manifests and declares push contributions only when the registry enables push notifications. The build plan includes app-owned Firebase file copies, iOS background modes, APNs AppDelegate hooks, push entitlements, Xcode resource edits, and Firebase Messaging's SPM symlink setting. The environment defaults to `development`. Generation without Firebase files still declares push hooks and entitlements.

The shared plan applicator copies files and applies resolved edits. Neither platform generator imports notification modules, and `native-project.ts` takes SPM settings from the plan. Local-only builds omit all push contributions. Equal entitlement and SPM values deduplicate; different values fail with `InvalidConfig` naming the setting.
