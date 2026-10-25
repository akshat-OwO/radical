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

## iOS prototype outcome

The iOS shell uses the tab controller for its bars. Its single bridge controller and WebView stay in a fixed container.

A UIKit prototype built with the iOS 27.1 SDK moved one WKWebView between two UITab containers on the iPhone 17 Pro simulator running iOS 26.5. Before selection, an HTML input held `preserved`, was the active DOM element, and had a native first responder with the software keyboard visible. After moving to the other tab, the document UUID, input value, and DOM active element were unchanged, but the software keyboard disappeared. The accessibility snapshot also lost the keyboard nodes. Moving preserved the document but failed the keyboard requirement, so the shell uses the fixed-container fallback.

UITab selection emits an unretained intent and waits for the adapter's resolved state before changing selection. The tab containers contain no WebViews. UIKit's content layout guide supplies the unobscured rectangle on iOS 26 and later, including the Duo's vertical bar. On iOS 18, the selected container's safe-area layout guide supplies that rectangle. The WebView's container fills the window directly above the tab content container, so the page draws under the status bar and behind the Liquid Glass bars while UIKit keeps the bars and sidebar on top. The bridge controller publishes that rectangle as safe-area insets through the existing native-context cookie and bridge events. An earlier version clipped the container to the rectangle, which left blank system-background strips and gave the glass nothing to show through.

Sections are compiled into the shell, so bars exist before the first bridge message in remote, bundled, and offline launches. Apps with sections target iOS 18 in both Xcode and the generated Swift package. Apps without sections retain iOS 15 and their existing bridge controller root.

## Android prototype outcome

The Android shell keeps its WebView in Capacitor's original container. Material Components draws a bottom bar or a rail as sibling views. The WebView never changes parents when the width class, posture, visibility, or selection changes.

A Java Activity prototype on the Pixel 9 emulator running Android 16 moved one WebView between two FrameLayouts while an input held DOM focus and the software keyboard was visible. The document, the input value, and the DOM active element survived. The native `WebView.hasFocus()` changed from true to false, and `dumpsys input_method` reported the keyboard hidden after the move. Moving failed the focus and keyboard requirement, so Android also uses the fixed-container fallback.

The fixed WebView retains window-sized CSS dimensions. Its clip bounds exclude bar space, which reaches the page through safe-area insets. A separating vertical hinge limits controls to the left pane. A separating horizontal hinge limits the rail to the upper pane and the bottom bar to the lower pane. Bars are compiled from section declarations and are present before the page mounts, including bundled and offline launches.

## Platform back outcome

The page decides back, because only the adapter knows sections, route memory, and router history. It publishes whether it handles back and whether that is a history pop, and the shells send back requests to it. Android enables its back callback only while the page handles back, so the system shows its own predictive animation for leaving the app. Section selections replace the current history entry. Without that, switching sections and pressing back would alternate between sections indefinitely.

The iOS shell tracks its own left-edge pan instead of `UIScreenEdgePanGestureRecognizer`, which never receives touches over WKWebView. Retained overlays are UIKit window snapshot views, about as cheap as the overlays forward transitions already create. They are capped at five. The live content moves during the swipe, including the tab bar, matching the existing slide transitions.
