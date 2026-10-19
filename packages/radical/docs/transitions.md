# Browser transitions

Import the stylesheet once, then install transitions on each TanStack Router in `getRouter`:

```ts
import { browserTransitions } from "radical/tanstack-start";
import "radical/transitions.css";

const router = createRouter({ routeTree });
const transitions = browserTransitions(router, { timeoutMs: 1000 });
```

Declare the destination route's transition in its static data:

```ts
staticData: {
  radical: {
    transition: "slide";
  }
}
```

`slide` and `fade` use View Transition types and CSS pseudo-elements. The deepest declared transition wins. An unmarked route navigates normally unless an ancestor declares a transition. The initial load and same-URL navigations do not transition. Links, `router.navigate`, and history navigation all use the same controller. Pass `viewTransition: false` to Router navigation to bypass it.

History entries with a lower index use `back`. Other navigations use `forward`. Override direction with `browserTransitions(router, { direction: (direction) => direction === "back" ? "forward" : "back" })`.

Set duration through CSS, without measuring or rewriting the DOM on navigation:

```css
:root {
  --radical-transition-duration: 300ms;
}
```

The default duration is 250ms. Reduced-motion preferences disable movement. Keep `timeoutMs` longer than the configured duration. Its default is 1000ms. On timeout, cancellation, capture failure, or missing browser support, the route still commits once. `transitions.cancel()` skips the current transition. `transitions.dispose()` also restores Router's original hook. A newer navigation cancels the previous transition automatically.

Router owns route loading and DOM commits. Its built-in `viewTransition` path exposes no handle for cancellation or timeout and does not recover from a throwing browser API. The adapter therefore replaces only `router.startViewTransition`, using the browser's typed View Transitions API directly. It does not intercept links or history and does not nest transitions.

`tanstackStartAdapter(router)` supplies `RadicalAdapter` navigation through a Layer. The no-router `TanStackStartAdapter` still reports unavailable navigation. Before listeners observe navigation and run their Effects as fibers. They do not block Router. Both before and after subscriptions return unsubscribe functions.

`radical/client` exports `TransitionSchema`, with `kind` and `direction`, and the Effect controller. `BrowserTransitions` is the replaceable browser boundary for in-memory tests and future shell work. No shell transition is implemented here.
