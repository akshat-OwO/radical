import type { AnyRouter } from "@tanstack/react-router";
import type { Layer } from "effect";
import { Cause, Effect, Fiber } from "effect";

import { AdapterUnavailable } from "./adapter-error.ts";
import type { RadicalNavigation } from "./adapter.ts";
import { BrowserTransitionsLive, runBrowserTransition } from "./client.ts";
import type { Transition, BrowserTransitions } from "./client.ts";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    radical?: {
      readonly transition?: Transition["kind"];
      readonly offline?: boolean;
    };
  }
}

export interface BrowserTransitionOptions {
  readonly timeoutMs?: number;
  /** Override history-derived direction, for example for a right-to-left UI. */
  readonly direction?: (
    direction: Transition["direction"]
  ) => Transition["direction"];
}

/** Install once on each router. Import radical/transitions.css once in the app. */
export const browserTransitions = (
  router: AnyRouter,
  options: BrowserTransitionOptions = {},
  browser: Layer.Layer<BrowserTransitions> = BrowserTransitionsLive
) => {
  const original = router.startViewTransition;
  let cancel = Effect.void;
  router.startViewTransition = (update) => {
    Effect.runFork(cancel);
    const from = router.stores.resolvedLocation.get();
    const to = router.latestLocation;
    const enabled = router.shouldViewTransition !== false;
    router.shouldViewTransition = undefined;
    const matches = router.matchRoutes(to.pathname);
    const kind = matches.findLast(
      (match) => match.staticData.radical?.transition
    )?.staticData.radical?.transition;
    if (!enabled || !kind || from === undefined || from.href === to.href) {
      return update();
    }
    const direction =
      (to.state.__TSR_index ?? 0) < (from?.state.__TSR_index ?? 0)
        ? "back"
        : "forward";
    const fiber = Effect.runFork(
      runBrowserTransition(
        { kind, direction: options.direction?.(direction) ?? direction },
        Effect.promise(update),
        options.timeoutMs
      ).pipe(Effect.provide(browser))
    );
    cancel = Fiber.interrupt(fiber).pipe(Effect.asVoid);
    return Effect.runPromise(
      Fiber.join(fiber).pipe(
        Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void)
      )
    );
  };
  return {
    cancel: () => {
      Effect.runFork(cancel);
    },
    dispose: () => {
      Effect.runFork(cancel);
      router.startViewTransition = original;
    },
  };
};

export const tanstackNavigation = (router: AnyRouter): RadicalNavigation => ({
  navigate: (to, options) =>
    Effect.tryPromise({
      try: () => router.navigate({ to, ...options }),
      catch: () => new AdapterUnavailable({ operation: "navigate" }),
    }),
  onBeforeNavigate: (listener) =>
    Effect.sync(() =>
      router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
        Effect.runFork(listener(fromLocation?.href ?? "", toLocation.href));
      })
    ),
  onAfterNavigate: (listener) =>
    Effect.sync(() =>
      router.subscribe("onResolved", ({ toLocation }) => {
        listener(toLocation.href);
      })
    ),
});
