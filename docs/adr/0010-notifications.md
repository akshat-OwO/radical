# 0010: Notification plugins and topic membership

Use Capacitor Local Notifications 8.3.1 for OS scheduling and permission, Capawesome Badge 8.0.4 for launcher badges, and Capacitor Firebase Messaging 8.5.2 for FCM tokens and push taps. Firebase Messaging provides topics on both platforms, whereas Capacitor Push Notifications alone would require a second Firebase integration. Keep Firebase opt-in so local reminders need no Firebase project. Enabling local or push notifications also registers Capacitor Network 8.0.1 from `@capacitor/network`, even when `internalPlugins.network` is false. Notification taps need its native network status to select snapshots.

FCM has no client API for listing subscriptions. A small native RadicalNotificationTopics plugin records successful subscriptions and unsubscriptions in installation-local persistent storage. Lookup means confirmed local membership, not an authoritative server query. Failed FCM operations leave the record unchanged. This trades server reconciliation for a useful offline lookup without adding a backend or shipping administrative credentials.

Browser reminders use the Notification API and an Effect clock. They last only while the page remains open. Validate payloads before bridge calls, reject external notification routes, and own navigation listeners in an app-wide scope. Offline taps and taps with unavailable network status check the route's exact-URL snapshot before adapter navigation. A failed status read never selects the connected branch. Firebase files remain app-owned and outside version control. Native generation copies explicitly configured files, wires APNs callbacks, and adds iOS push entitlements. Builds without those files compile but cannot verify tokens or topic delivery.

Notification restore uses `core/offline/offline-protocol.ts` to select only the configured app ID's snapshot caches across base paths and build versions. Its shared snapshot key preserves the exact query string and omits fragments, matching the worker and native snapshot checks.

## Build plan contributions

`notification-build.ts` sits beside the notification manifests and declares push contributions only when the registry enables push notifications. The build plan includes app-owned Firebase file copies, iOS background modes, APNs AppDelegate hooks, push entitlements, Xcode resource edits, and Firebase Messaging's SPM symlink setting. The environment defaults to `development`. Generation without Firebase files still declares push hooks and entitlements.

The shared plan applicator copies files and applies resolved edits. Neither platform generator imports notification modules, and `native-project.ts` takes SPM settings from the plan. Local-only builds omit all push contributions. Equal entitlement and SPM values deduplicate; different values fail with `InvalidConfig` naming the setting.

## Exact alarms

Keep the `SCHEDULE_EXACT_ALARM` permission declared by Capacitor Local Notifications 8.3.1's library manifest. Android merges that declaration into the app manifest. A Radical config flag that only adds the same permission cannot control access, so expose no exact-alarm config option or manifest contribution. This preserves exact alarms by default on Android 12 and 13, which grant access at install. Users can still revoke access.

On Android 14 and later, most newly installed apps targeting API 33 or higher receive no default grant. Exemptions and existing grants during an OS upgrade can preserve access. See [Android's exact-alarm permission changes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms). Request access through system settings when the check returns `denied`. Notification display permission is separate from exact-alarm access.

Neither Radical nor the plugin declares `USE_EXACT_ALARM`, because [Google Play restricts it](https://support.google.com/googleplay/android-developer/answer/13161072) to qualifying core alarm and calendar use cases.

Expose separate check and request Effects for this access. Return `granted` or `denied` on Android and `not-required` on iOS and browsers. The latter platforms have no Android exact-alarm setting and make no bridge call. Keep bridge failures and malformed responses typed through the existing plugin client.

Decode scheduling's notification IDs and optional warning instead of returning an unknown payload. Preserve warning codes and messages, including `OS-PLUG-LNOT-0017` for an inexact fallback. Return accepted IDs without a warning in browsers, and retain schedule results in the React hook. Absence of a warning does not guarantee delivery timing. Request access before scheduling so the settings interaction does not consume the notification delay. A later grant requires rescheduling an existing inexact reminder.
