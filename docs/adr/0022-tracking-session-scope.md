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

These product boundaries were confirmed in the design interview. Public API signatures, acquisition presets, and native implementation details remain implementation work within these boundaries.
