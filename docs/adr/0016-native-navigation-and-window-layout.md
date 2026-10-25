# 0016: Native navigation and window layout

- Status: accepted
- Date: 2026-10-25

## Context

Platforms place navigation controls for the current window: a bottom tab bar on phones, a vertical bar on the iPhone Duo's outer display, a sidebar on its inner display and on iPad, and a rail on Android foldables and tablets. They only do this for their own UIKit and Material controls. Navigation drawn in HTML inside radical's single WebView never adapts this way, so the app still looks like a website in a frame.

## Decision

Radical declares navigation and lets the shell draw it. It ships in two layers.

**Window layout first.** Native context gains a cross-platform width class (`compact`, `medium`, or `expanded`, using Material's 600 and 840 breakpoints in CSS pixels), a posture (`flat`, `tabletop`, or `book`), and a hinge rectangle or `null`. iOS always reports `flat` with no hinge. The value travels in the native context cookie so server rendering lays out correctly on first paint. The shell rewrites the cookie and emits a bridge event when the window changes. The first client render matches the server render, and live values apply after mount, as with safe area. Browsers derive the width class from `matchMedia` and report `flat` with no hinge. Radical does not depend on the experimental Viewport Segments API.

**Native navigation as an opt-in.** Apps list 2 to 5 sections in radical config: id, title, route, and an icon given as an SF Symbol name for iOS and an SVG for Android, converted to a VectorDrawable at build time. Configuring sections turns native navigation on. A route belongs to the section with the longest matching path prefix. Routes outside every section, or with `staticData.radical.navigation: "hidden"`, hide the bars. Each section remembers its last route. Tapping the active section returns to its root. Switching sections never animates; navigation inside a section keeps its route transition.

The shell draws the bars and sends selection intents. The adapter performs the route change, so routing stays with the host framework, as ADR 0001 requires. iOS uses `UITab`-based sidebar-adaptive tabs and raises the deployment target to iOS 18 only for apps that configure sections. Android uses Material Components views from the Java template: a bottom bar at `compact` width and a rail at `medium` and `expanded`, with Jetpack WindowManager for posture.

Every platform keeps one WebView. If it cannot move between native tab containers cleanly, the tab controller draws only the bars, and the WebView stays in a fixed container inset by their size.

A headless `useSections()` hook returns the sections, the active one, `select(id)`, and `setBadge(id, value)`. Apps use it to draw their own navigation in browsers or in shells without sections. Radical ships no styled navigation component.

System back follows each platform. On Android, back within a section pops router history. Back at a section root goes to the start section (the first in config), and back at the start section's root leaves the app, with predictive back previews. On iOS, the edge swipe is interactive: it reveals retained transition overlays to a bounded depth, and past that depth it runs the reversed slide transition.

## Considered options

- **Web-drawn adaptive navigation only.** It is cheaper and identical in browsers, but the platform never places or styles it. Window layout plus `useSections()` still allows it.
- **Capgo `@capacitor-native-navigation`.** It does not cover sidebars, split view, or the iPhone Duo, and it would add a third-party dependency of unclear maturity at a core seam.
- **One WebView per section.** This gives true per-section state but multiplies memory and splits the bridge, offline snapshots, and cookies across WebViews.
- **Jetpack Compose `NavigationSuiteScaffold`.** It adapts more out of the box but needs Kotlin, the Compose compiler, and a larger APK.
- **Keeping iOS 15 with a classic tab bar fallback.** It doubles the iOS code paths for a shrinking share of devices.

## Consequences

- Native top bars (title, back button, actions) are deferred. They will be opt-in per route.
- Hiding sections at runtime is deferred, because it would make native navigation depend on authentication state.
- Badges are not persisted across launches.
- Shells must build with the iOS 27.1 SDK for the iPhone Duo's vertical bars.
