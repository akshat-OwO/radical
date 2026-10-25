# Route transitions

Import the stylesheet once, then install transitions on each TanStack Router in `getRouter`:

```ts
import { browserTransitions } from "@akshatowo/radical/tanstack-start-client";
import "@akshatowo/radical/transitions.css";

const router = createRouter({ routeTree });
const transitions = browserTransitions(router, { timeoutMs: 1000 });
```

Declare the destination route's transition in its static data:

```ts
export const Route = createFileRoute("/details")({
  staticData: { radical: { transition: "slide" } },
});
```

In browsers, `slide` and `fade` use Router's `defaultViewTransition.types` option and CSS pseudo-elements. The deepest declared transition wins. An unmarked route navigates normally unless an ancestor declares a transition. Initial loads and same-URL navigations do not transition. Links, `router.navigate`, and history navigation use Router's own transition implementation. Pass `viewTransition: false` to Router navigation to bypass transitions.

Direction comes from the public history subscription. `BACK` and negative `GO` actions use `back`; other actions use `forward`. Override direction with `browserTransitions(router, { direction: (direction) => direction === "back" ? "forward" : "back" })`.

Set browser duration through CSS:

```css
:root {
  --radical-transition-duration: 300ms;
}
```

The default browser duration is 250ms. Reduced-motion preferences disable movement. `timeoutMs` defaults to 1000ms and limits the animation after Router resolves navigation. It does not delay navigation. Browsers own capture and its timeout. Router waits for the DOM update callback, independently of animation completion. Unsupported browsers apply the update directly. A skipped transition still runs its update callback, including when capture fails.

`transitions.cancel()` calls `document.activeViewTransition?.skipTransition()`. The timeout also skips the active transition, using its public `finished` promise. These controls require browser support for `document.activeViewTransition`; Router's transition and fallback behavior still work without it. `transitions.dispose()` stops the watcher, cancels the animation, removes subscriptions, and restores the previous `defaultViewTransition` option. The browser skips an older transition when another starts.

`tanstackStartAdapterLayer(router)` supplies `RadicalAdapter` navigation through a lazy Layer. Import it from `@akshatowo/radical/effect/tanstack-start-client` to keep build and server dependencies out of the browser module graph. The no-router `TanStackStartAdapter` wires server request context and reports unavailable navigation; the client Layer reports unavailable request context. Router navigation failures produce `NavigationFailed` with the original cause. Before listeners run their Effects as fibers and do not block Router. Both before and after subscriptions return unsubscribe functions.

## Native snapshot overlays

The existing `browserTransitions(router)` installer detects shells through the Bridge and selects native snapshots automatically. No app API changes are required. Shells do not call `document.startViewTransition`, including on WebViews that support it. The router-specific adapter wraps TanStack's `startViewTransition` commit boundary. This hook covers links, imperative navigation, and history without changing global browser APIs. Keep the pinned Router version and the commit-boundary tests when upgrading Router.

`@akshatowo/radical/effect/client` owns `transitionStrategy`, which selects native overlays for both shells, browser view transitions when typed selectors exist, and plain navigation otherwise. It exports the router-independent `nativeTransition` Effect, `NativeTransitions` service, live Layer, and `TransitionTimeout`. `TransitionSchema` describes `kind` and `direction`. `BrowserTransitions` and `NativeTransitions` accept in-memory implementations for tests.

The generated shell registers a radical-owned Capacitor plugin named `RadicalTransitions`. All commands return `{ id: string }`. The Bridge decodes that result with Schema and checks that the id matches the request. The `NativeTransitions` capability owns a shared monotonic overlay id sequence because the native plugin has one overlay slot. Its `nextId` Effect allocates an id only when a native transition starts. The sequence survives live Layer rebuilds, router installations, and disposal, so stale callbacks cannot match a newer overlay. The adapter owns no id counter. Plain navigation needs no id, and insecure development origins need no Web Crypto support.

- `cover({ id })` replaces any older overlay, captures the full window, attaches the snapshot above the WebView, and acknowledges attachment.
- `reveal({ id, kind, direction, reducedMotion })` waits for native paint readiness, then animates a push or fades the snapshot opacity to zero over 250ms. Forward slides move the new WebView content in from the right, above the outgoing snapshot, which moves left by 30% of the window width. Back slides move the outgoing snapshot to the right while the destination moves from a -30% offset to zero. iOS dims the background page by 12%.
- `remove({ id })` immediately removes that overlay. Repeated removals and commands for a stale id succeed without affecting a newer overlay.

Capture acknowledgement gates the router's commit callback. The callback acknowledges the framework commit, then JavaScript waits for two animation frames. Android additionally uses `WebView.postVisualStateCallback`, whose next draw includes preceding DOM changes. iOS waits for `WKWebView.takeSnapshot` to complete with an image of the new content before animating the old snapshot. The paint probe image is discarded. Neither platform hides the live WebView or swaps its background. The snapshot covers the new content until the renderer has produced the destination. Forward reveal sets the incoming content offset and moves the snapshot behind it in the same native frame. Back reveal sets the destination parallax offset under the still-opaque snapshot. Cleanup resets the live content transform before removing the snapshot.

Android copies the hardware-rendered window with PixelCopy on API 26 or later. Its callback attaches an ImageView before acknowledging capture. Failed copies and older Android versions use plain navigation. Expiry and id checks also cover pending copies, so a late callback cannot attach an abandoned snapshot. iOS snapshots the UIWindow and attaches that snapshot to the window's bounds. These coordinates include the shared edge-to-edge content under system bars, with no safe-area inset applied to the overlay. Both native implementations also check the system reduced-motion setting. Either that setting or the CSS media query disables animation.

`timeoutMs` defaults to 1000ms for capture, painted-plus-reveal, and cleanup waits. The router commit always runs to completion without a transition timeout. Capture failure or timeout removes the overlay before running the commit once as plain navigation. Commit failure keeps its typed error and runs cleanup. Slow commits continue even after the native watchdog expires the snapshot. Their result and their own typed errors propagate unchanged. `TransitionTimeout` represents an overlay operation timing out; recovery consumes that error and keeps navigation running. Reveal failure or timeout preserves the committed route and runs cleanup. Interruption also removes the overlay. Cleanup failure is bounded and ignored because each shell independently expires its overlay three seconds after capture, even if JavaScript dies. Native commands carry an id so late paint, animation, and watchdog callbacks cannot remove a newer overlay.

History `BACK` and negative `GO` reverse slide direction. App back controls and SPA history changes use the reversed native slide. Cross-document links use platform navigation rather than a second radical overlay.

## System back

The native installer also owns system back. It records each history entry's full internal href by TanStack's `__TSR_index` in session storage, so decisions survive reloads. After every resolved navigation, and when `TanStackSections` binds, it decides what back would do:

- Below a section root, pop when the previous href differs and belongs to the same section. Query and hash changes count. Hidden and unowned routes keep their pathname-based history behaviour.
- Otherwise, inside a section but away from its root, replace the entry with the section root.
- At any section root, pop only for a different href with the same pathname. Otherwise, at another section's root, replace the entry with the start section's destination, which restores its route memory.
- Otherwise, at the start section's root, exit. Without sections, pop if there is a previous entry, or exit.

Selections replace history and play the reversed slide when they stay inside a section. The installer publishes the decision with `setBack({ handles, pop, index })` and receives `radicalBack` events with `{ interactive }`.

- `setBack` is advisory. Android enables its `OnBackPressedCallback` only while `handles` is true, so a page at the start root lets the system preview leaving the app. Until the first `setBack`, Android follows WebView history as before.
- Android declares `android:enableOnBackInvokedCallback`. During an in-app predictive back gesture, the content scales down by up to 8% and shifts toward the far edge. Release resets it before the reversed slide captures. Cancel resets it.
- `exit({})` disables the callback for one dispatch. iOS has nothing to exit to.
- iOS tracks a pan that starts within 24 points of the left edge, only while `pop` is true. Forward transitions retain the window snapshot of the page they leave, keyed by its history index, up to five entries. `setBack` drops snapshots at or above the live index. With a retained snapshot, the live content follows the finger over the snapshot, which moves from a -30% parallax offset under a fading 12% dim. Release past 35% of the width, or with a rightward velocity above 600 points per second, finishes the slide and sends `{ interactive: true }`. The installer pops without a second animation, waits for paint, and calls `settle({})`, which restores the live content once WebKit has drawn the popped page. Earlier releases animate back and remove the snapshot. A three-second watchdog restores the page if `settle` never arrives. Past the retained depth, or after the shell restarts, the page does not track the finger; release sends `{ interactive: false }`, which runs the reversed slide.

`cancel()` removes the current native overlay without interrupting the router commit. `dispose()` also restores the original router hook and removes history listeners. Concurrent commits serialize their overlays so an earlier cleanup cannot uncover a later capture. Browser cancellation and CSS duration behavior remain unchanged.

See [native verification](../../../docs/verification/native-transitions.md) for Android and iOS device recordings, stills, and timeout recovery evidence.
