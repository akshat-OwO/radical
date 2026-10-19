# Browser transitions

Import the stylesheet once, then install transitions on each TanStack Router in `getRouter`:

```ts
import { browserTransitions } from "radical/tanstack-start-client";
import "radical/transitions.css";

const router = createRouter({ routeTree });
const transitions = browserTransitions(router, { timeoutMs: 1000 });
```

Declare the destination route's transition in its static data:

```ts
export const Route = createFileRoute("/details")({
  staticData: { radical: { transition: "slide" } },
});
```

`slide` and `fade` use Router's `defaultViewTransition.types` option and CSS pseudo-elements. The deepest declared transition wins. An unmarked route navigates normally unless an ancestor declares a transition. Initial loads and same-URL navigations do not transition. Links, `router.navigate`, and history navigation use Router's own transition implementation. Pass `viewTransition: false` to Router navigation to bypass transitions.

Direction comes from the public history subscription. `BACK` and negative `GO` actions use `back`; other actions use `forward`. Override direction with `browserTransitions(router, { direction: (direction) => direction === "back" ? "forward" : "back" })`.

Set duration through CSS:

```css
:root {
  --radical-transition-duration: 300ms;
}
```

The default duration is 250ms. Reduced-motion preferences disable movement. `timeoutMs` defaults to 1000ms and limits the animation after Router resolves navigation. It does not delay navigation. Browsers own capture and its timeout. Router waits for the DOM update callback, independently of animation completion. Unsupported browsers apply the update directly. A skipped transition still runs its update callback, including when capture fails.

`transitions.cancel()` calls `document.activeViewTransition?.skipTransition()`. The timeout also skips the active transition, using its public `finished` promise. These controls require browser support for `document.activeViewTransition`; Router's transition and fallback behavior still work without it. `transitions.dispose()` stops the watcher, cancels the animation, removes subscriptions, and restores the previous `defaultViewTransition` option. The browser skips an older transition when another starts.

`tanstackStartAdapterLayer(router)` supplies `RadicalAdapter` navigation through a lazy Layer. Import it from `radical/tanstack-start-client` to keep build and server dependencies out of the browser module graph. The no-router `TanStackStartAdapter` wires server request context and reports unavailable navigation; the client Layer reports unavailable request context. Router navigation failures produce `NavigationFailed` with the original cause. Before listeners run their Effects as fibers and do not block Router. Both before and after subscriptions return unsubscribe functions.

`radical/client` exports `TransitionSchema`, with `kind` and `direction`, alongside the offline registration API. `BrowserTransitions` supplies replaceable active-transition handles for in-memory tests. The transition description remains independent of Router for the native snapshot implementation in #12.
