# 0020: Page-controlled section bar visibility

A launch animation runs in the page, under the native section bar. Before this decision, the iOS tab bar showed over the splash for the whole launch, and the Android bar appeared at once when the splash hid, while the animation was still running. Only routes could hide the bar.

The sections controller gains `setHidden(hidden)`. `true` hides the controls on every route and keeps the active section; `false` lifts the override, and hidden routes stay hidden. The snapshot's `hidden` covers both, so native shells and web controls need no new field. The iOS splash moves into the tab controller's view, above the bars, to match Android, where the splash already covers the bar. A launch animation calls `setHidden(true)` before `hideSplash()` and `setHidden(false)` when it ends.

The shells animate a bar when its visibility changes and the active section stays the same, which only the page override causes. A route change that hides the bar also clears the active section, so the bar still hides at once, as in ADR 0016.

## Considered Options

- `hideSplash({ navigation: "defer" })` with a `showNavigation()` call. Rejected: it covers launch only, while the override also serves full-screen media and other page states.
- Sliding the bar in automatically when the splash hides. Rejected: the slide would still run during the page's launch animation.
- Keeping bar insets while the page hides the bar. Rejected: hidden routes already drop insets, and on iOS this would need manual transforms of the tab bar in place of `setTabBarHidden`.

## Consequences

- Insets change when the page hides or shows the bar. Content anchored to the bottom inset moves once when the bar slides in.
- Android slides the bar. iOS uses `setTabBarHidden(_:animated:)`, which fades the glass tab bar on iOS 26. The iPad sidebar shows and hides at once, since UIKit has no animated variant.
- While the Android bottom bar slides, the WebView stays unclipped, so the page shows where the bar has not arrived yet.
- The override lives in memory and resets on reload.
