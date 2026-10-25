# 0016: Native navigation and window layout

- Status: accepted
- Date: 2026-10-25

## Context

UIKit and Material place native navigation controls for the current window. HTML navigation cannot use that platform behavior. Radical also needs to preserve page state, input focus, and the keyboard when navigation changes.

## Decision

Apps opt in with 2 to 5 configured sections. The shell draws controls and sends selection intents. The adapter owns routing, section memory, visibility, and badges, as ADR 0001 requires. A headless `useSections()` supports custom web controls. Radical ships no styled web component.

Sections use longest-prefix path ownership. Unowned and explicitly hidden routes hide controls. Selecting an inactive section restores its last URL; reselecting the active section returns to its root. Cross-section navigation skips transitions. Navigation within a section keeps route transitions.

Window layout joins native context with width classes at 600 and 840 CSS pixels, fold posture, and hinge bounds. Android uses WindowManager; iOS reports flat with no hinge. Browsers use `matchMedia`, avoiding a dependency on the experimental Viewport Segments API.

Layout travels through the native-context cookie for server rendering and bridge events for updates. The client keeps provider values until mount to preserve hydration. Hinge CSS variables appear before mount only when the document declares them through `windowLayoutStyle`.

### Platform bar choice

`navigation.bar` selects native or web controls per platform. The shell includes `nativeSectionBar` in native context so remote SSR and hydration agree on `useSections().native`. Bundled hydration uses the provider first, then reads the injected shell context. Routing and back remain independent of who draws controls.

Android themes use generated `values` and `values-night` color resources. Only declared colors override Material defaults.

## One fixed WebView

Both shells keep one WebView in a fixed container. Moving a WebView between native containers preserved document state in prototypes but broke focus or keyboard behavior:

| Prototype | Result after moving |
| --- | --- |
| iPhone 17 Pro, iOS 26.5, built with SDK 27.1 | Input value and DOM focus survived. Software keyboard disappeared. |
| Pixel 9, Android 16 | Input value and DOM focus survived. Native WebView focus and software keyboard were lost. |

On iOS, a `UITab` controller owns only controls. The WebView fills the window under the status bar and navigation bars. UIKit's content layout guide on iOS 26+, or the selected container's safe-area guide on iOS 18, supplies safe-area insets. Clipping to that rectangle left blank strips and prevented content from showing through glass bars.

On Android, Material controls sit beside the fixed WebView. The WebView retains window-sized CSS dimensions and clips bar space; safe-area insets place page content clear of controls. Separating hinges constrain controls to one pane.

Declarations compile into both shells so controls exist before mount, including offline launches. iOS opens the sidebar at launch only in regular-width landscape windows to avoid dimming narrow windows with an overlay.

## System back

The adapter decides back because it knows router history and sections. Within a section it pops a different URL owned by that section, or returns to the root. At a root it selects the start section; at the start root it exits. A root still pops a previous entry with the same pathname and a different query or hash. Without sections, back follows history and exits at the bottom.

Section selections replace history to prevent back from alternating between sections. History stores full internal hrefs; internal navigation preserves rewrites, query strings, and hashes.

Android enables its back callback only while the page handles back. This leaves the system's predictive back-to-home preview in control at exit.

iOS uses a left-edge pan because WebKit intercepts screen-edge recognizers. Forward slides retain at most five window snapshots for interactive history pops. Without a snapshot, release runs the reversed slide. Roots do not enable swipes unless back pops a query/hash history entry.

## Alternatives

| Option | Reason rejected |
| --- | --- |
| Web navigation only | Cannot use native placement and styling. Still available through `useSections()`. |
| Capgo `@capacitor-native-navigation` | Does not cover the required sidebars, split view, and Duo placement. Adds a core third-party dependency. |
| One WebView per section | Multiplies memory and splits bridge, offline snapshots, and cookies. |
| Compose `NavigationSuiteScaffold` | Requires Kotlin, the Compose compiler, and a larger APK. |
| iOS 15 tab-bar fallback | Adds a second navigation implementation. |

## Consequences

- Apps with native iOS bars require iOS 18; web bars and other apps retain iOS 15. Duo vertical bars require the iOS 27.1 SDK.
- Android apps with native bars add Material Components 1.14.0 and a Material 3 theme.
- Badges stay in memory and do not survive launches.
- Native title bars, back buttons, actions, and runtime section removal are deferred. Runtime removal would tie native declarations to authentication state.
