---
status: accepted
---

# 0022: Tracking session scope

The agreed scope for background location is an explicitly user-started tracking session on Android and iOS, independently opt-in from storage. Foreground location keeps its existing behavior under ADR 0015. Implementation may ship separately on each platform, and browser support must state its limits.

A tracking session collects location while the screen is locked or another app is visible. It provides the latest location fix and session status, without durable location history or background execution of application journey logic. This keeps collection separate from route evaluation and arrival alerts, which need their own execution model.

One tracking session may be active per installed app. Screens can access the same session, and leaving a screen does not stop collection. Stopping the session is explicit, so screen lifecycle cannot accidentally end user-started tracking.

Starting another session while one is active returns a typed error. Screens retrieve the existing session explicitly rather than silently replacing its settings. Acquisition uses named presets with optional interval and minimum-distance settings. These express requested behavior, not guaranteed delivery intervals.

After app termination, report the interrupted session when the app returns and require explicit restart. Do not silently restart after a user stops tracking. This avoids promising uninterrupted collection across platform termination rules.

Permission revocation ends the session and requires explicit restart. Location services being off suspends acquisition and reports the reason. Acquisition may recover within that session when services return. Ordinary acquisition timeouts report an error without ending the session.

These product boundaries were confirmed in the design interview. The decisions below settle the owner, platforms, and lifecycle within them.

## Decision

Native code owns the session and keeps one current snapshot. Pages only observe it. A JavaScript singleton cannot enforce one session per app across runtimes and WebView reloads. Each snapshot carries the session id and a revision, and a page drops any snapshot older than the one it has.

Tracking is native-only. In a browser, and in shells built before tracking existed, every tracking call fails with `Unavailable`. The Geolocation spec delivers watches only to visible documents, so a browser cannot meet the scope. Foreground location (ADR 0015) stays the browser alternative.

On Android, a radical-owned foreground service with `foregroundServiceType="location"` collects fixes through `FusedLocationProviderClient`. It starts only while the activity is visible, so starting from the background fails with `TrackingStartRequiresForeground`. It shows an ongoing notification with a Stop action, uses `START_NOT_STICKY`, and has no boot receiver or scheduled restart. `ACCESS_BACKGROUND_LOCATION` is not requested: a foreground service started from a visible activity keeps foreground location access. When notification permission is denied on Android 13+, tracking still runs and the session reports the denial.

On iOS, an app-owned `CLLocationManager`, outside the WebView and plugin lifecycle, runs standard updates with `UIBackgroundModes: location` and `allowsBackgroundLocationUpdates`. When-In-Use permission is enough, so radical never requests Always authorization or uses significant-change monitoring. The minimum stays iOS 15. `UIBackgroundModes` values are merged across capabilities.

Tracking runs with approximate permission. Precise location stays a separate request through the ADR 0015 purpose keys, and the session reports the precision actually granted.

Before acknowledging start, the shell persists only the session id, options, start time, and terminal state, in private, backup-excluded native preferences. On a fresh process an unfinished session becomes `interrupted: termination` with `latest: null`, and nothing restarts. The latest fix survives a WebView reload but not a process kill. Destruction callbacks are not relied on, because a force-stop skips them. This metadata does not use or enable app storage (ADR 0023).

Starting while location services are off fails with `LocationServicesOff`. A running session moves to `suspended: servicesOff` and returns to `running` when services return. Revoking permission ends it as `stopped: permissionRevoked`, and a later grant does not restart it. On iOS, Core Location reports denial while services are off, so the shell checks services first and classifies a revocation once authorization can be resolved. An acquisition timeout goes into `lastError` without ending the session.

A stopped or interrupted session stays readable until the next start replaces it. `stop` is idempotent for the current id and rejects a stale id with `TrackingSessionNotFound`. A second start while one runs fails with `TrackingSessionAlreadyActive`, which carries the existing id.

Presets are requests, not delivery guarantees, and `interval` and `minimumDistance` override them:

| Preset | Android | iOS |
| --- | --- | --- |
| `balanced` | Balanced power, 30 s, 50 m | Hundred-metre accuracy, `.other`, 50 m filter |
| `fitness` | High accuracy, 5 s, 5 m | Best accuracy, `.fitness`, 5 m filter |
| `navigation` | High accuracy, 1 s, 0 m | Best for navigation, `.automotiveNavigation`, no filter |

Core Location has no requested update interval, so on iOS `interval` only throttles how often the page receives fixes.

Tracking is opt-in through `internalPlugins.trackingSession: true`, which turns on `location` as well. Explanation strings and Android notification text go under `pluginOptions.TrackingSession`.

## Considered options

- **JavaScript-owned session.** Rejected: it cannot enforce one session per app across reloads, and it ends when the WebView does.
- **`ACCESS_BACKGROUND_LOCATION` or iOS Always authorization.** Rejected: user-started collection with a visible indicator does not need them, and both add a second prompt and stricter store review.
- **Automatic restart after termination.** Rejected: it would promise collection the platforms do not guarantee and could restart tracking the user believes is over.
- **Persisting the latest fix.** Rejected: storing location history at rest is outside the scope.

## Consequences

- Google Play reviews foreground-service location use, and apps must declare it in the Play Console.
- Denying notification permission on Android 13+ hides the notification and its Stop action, so the docs recommend granting it.
- Preset defaults need confirmation on devices.
