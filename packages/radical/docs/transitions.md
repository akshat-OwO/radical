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

`tanstackStartAdapterLayer(router)` supplies `RadicalAdapter` navigation through a lazy Layer. Import it from `@akshatowo/radical/tanstack-start-client` to keep build and server dependencies out of the browser module graph. The no-router `TanStackStartAdapter` wires server request context and reports unavailable navigation; the client Layer reports unavailable request context. Router navigation failures produce `NavigationFailed` with the original cause. Before listeners run their Effects as fibers and do not block Router. Both before and after subscriptions return unsubscribe functions.

## Native snapshot overlays

The existing `browserTransitions(router)` installer detects shells through the Bridge and selects native snapshots automatically. No app API changes are required. Shells do not call `document.startViewTransition`, including on WebViews that support it. The router-specific adapter wraps TanStack's `startViewTransition` commit boundary. This hook covers links, imperative navigation, and history without changing global browser APIs. Keep the pinned Router version and the commit-boundary tests when upgrading Router.

`@akshatowo/radical/client` owns `transitionStrategy`, which selects native overlays for both shells, browser view transitions when typed selectors exist, and plain navigation otherwise. It exports the router-independent `nativeTransition` Effect, `NativeTransitions` service, live Layer, and `TransitionTimeout`. `TransitionSchema` describes `kind` and `direction`. `BrowserTransitions` and `NativeTransitions` accept in-memory implementations for tests.

The generated shell registers a radical-owned Capacitor plugin named `RadicalTransitions`. All commands return `{ id: string }`. The Bridge decodes that result with Schema and checks that the id matches the request. The `NativeTransitions` capability owns a shared monotonic overlay id sequence because the native plugin has one overlay slot. Its `nextId` Effect allocates an id only when a native transition starts. The sequence survives live Layer rebuilds, router installations, and disposal, so stale callbacks cannot match a newer overlay. The adapter owns no id counter. Plain navigation needs no id, and insecure development origins need no Web Crypto support.

- `cover({ id })` replaces any older overlay, captures the full window, attaches the snapshot above the WebView, and acknowledges attachment.
- `reveal({ id, kind, direction, reducedMotion })` waits for native paint readiness, then animates a push or fades the snapshot opacity to zero over 250ms. Forward slides move the new WebView content in from the right, above the outgoing snapshot, which moves left by 30% of the window width. Back slides move the outgoing snapshot to the right while the destination moves from a -30% offset to zero. iOS dims the background page by 12%.
- `remove({ id })` immediately removes that overlay. Repeated removals and commands for a stale id succeed without affecting a newer overlay.

Capture acknowledgement gates the router's commit callback. The callback acknowledges the framework commit, then JavaScript waits for two animation frames. Android additionally uses `WebView.postVisualStateCallback`, whose next draw includes preceding DOM changes. iOS waits for `WKWebView.takeSnapshot` to complete with an image of the new content before animating the old snapshot. The paint probe image is discarded. Neither platform hides the live WebView or swaps its background. The snapshot covers the new content until the renderer has produced the destination. Forward reveal sets the incoming content offset and moves the snapshot behind it in the same native frame. Back reveal sets the destination parallax offset under the still-opaque snapshot. Cleanup resets the live content transform before removing the snapshot.

Android copies the hardware-rendered window with PixelCopy on API 26 or later. Its callback attaches an ImageView before acknowledging capture. Failed copies and older Android versions use plain navigation. Expiry and id checks also cover pending copies, so a late callback cannot attach an abandoned snapshot. iOS snapshots the UIWindow and attaches that snapshot to the window's bounds. These coordinates include the shared edge-to-edge content under system bars, with no safe-area inset applied to the overlay. Both native implementations also check the system reduced-motion setting. Either that setting or the CSS media query disables animation.

`timeoutMs` defaults to 1000ms for capture, painted-plus-reveal, and cleanup waits. The router commit always runs to completion without a transition timeout. Capture failure or timeout removes the overlay before running the commit once as plain navigation. Commit failure keeps its typed error and runs cleanup. Slow commits continue even after the native watchdog expires the snapshot. Their result and their own typed errors propagate unchanged. `TransitionTimeout` represents an overlay operation timing out; recovery consumes that error and keeps navigation running. Reveal failure or timeout preserves the committed route and runs cleanup. Interruption also removes the overlay. Cleanup failure is bounded and ignored because each shell independently expires its overlay three seconds after capture, even if JavaScript dies. Native commands carry an id so late paint, animation, and watchdog callbacks cannot remove a newer overlay.

History `BACK` and negative `GO` reverse slide direction, including Android system back. The generated Android shell registers an OnBackPressedDispatcher callback that calls WebView history when available and delegates to activity back otherwise. The button and system gesture share that path. iOS keeps WebKit's built-in history gestures disabled; radical does not enable a competing swipe animation. App back controls and SPA history changes use the reversed native slide. Cross-document links use platform navigation rather than a second radical overlay.

`cancel()` removes the current native overlay without interrupting the router commit. `dispose()` also restores the original router hook and removes history listeners. Concurrent commits serialize their overlays so an earlier cleanup cannot uncover a later capture. Browser cancellation and CSS duration behavior remain unchanged.

See [native verification](../../../docs/verification/native-transitions.md) for Android and iOS device recordings, stills, and timeout recovery evidence.
