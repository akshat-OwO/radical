import type { AnyRouter, RouterHistory } from "@tanstack/react-router";
import type { Layer } from "effect";
import { Effect, Fiber } from "effect";

import type { RadicalNavigation } from "./adapter.ts";
import {
  BrowserTransitions,
  BrowserTransitionsLive,
  cancelBrowserTransition,
  watchBrowserTransition,
} from "./browser-transitions.ts";
import type { Transition } from "./browser-transitions.ts";
import { NavigationFailed } from "./navigation-error.ts";

export interface BrowserTransitionOptions {
  readonly timeoutMs?: number;
  /** Override history-derived direction, for example for a right-to-left UI. */
  readonly direction?: (
    direction: Transition["direction"]
  ) => Transition["direction"];
}

/** Install once per router. Router owns capture, fallback, and DOM updates. */
export const browserTransitions = (
  router: Omit<AnyRouter, "history"> & { readonly history: RouterHistory },
  options: BrowserTransitionOptions = {},
  browser: Layer.Layer<BrowserTransitions> = BrowserTransitionsLive
) => {
  if (router.isServer) {
    return {
      cancel: () => {
        // No browser transition during SSR.
      },
      dispose: () => {
        // No subscriptions during SSR.
      },
    };
  }
  // Without typed selectors Router would start an untyped transition for every
  // navigation, so those browsers keep plain navigation.
  const supportsTypes = Effect.runSync(
    Effect.gen(function* () {
      const transitions = yield* BrowserTransitions;
      return yield* transitions.supportsTypes;
    }).pipe(Effect.provide(browser))
  );
  if (!supportsTypes) {
    return {
      cancel: () => {
        // No radical transition starts without typed selector support.
      },
      dispose: () => {
        // Nothing was installed.
      },
    };
  }
  const original = router.options.defaultViewTransition;
  let direction: Transition["direction"] = "forward";
  let stop = Effect.void;
  const removeHistory = router.history.subscribe(({ action }) => {
    direction =
      action.type === "BACK" || (action.type === "GO" && action.index < 0)
        ? "back"
        : "forward";
  });
  router.update({
    defaultViewTransition: {
      types: ({ fromLocation, toLocation }) => {
        if (
          fromLocation === undefined ||
          fromLocation.href === toLocation.href
        ) {
          return false;
        }
        const kind = router
          .matchRoutes(toLocation.pathname)
          .findLast((match) => match.staticData.radical?.transition)?.staticData
          .radical?.transition;
        if (!kind) {
          return false;
        }
        const transition: Transition = {
          kind,
          direction: options.direction?.(direction) ?? direction,
        };
        return [
          `radical-${transition.kind}`,
          `radical-${transition.direction}`,
        ];
      },
    },
  });
  const removeResolved = router.subscribe("onResolved", () => {
    Effect.runFork(stop);
    const fiber = Effect.runFork(
      watchBrowserTransition(options.timeoutMs ?? 1000).pipe(
        Effect.provide(browser)
      )
    );
    stop = Fiber.interrupt(fiber).pipe(Effect.asVoid);
  });
  const cancel = () => {
    Effect.runFork(cancelBrowserTransition.pipe(Effect.provide(browser)));
  };
  return {
    cancel,
    dispose: () => {
      Effect.runFork(stop);
      cancel();
      removeHistory();
      removeResolved();
      router.update({ defaultViewTransition: original });
    },
  };
};

export const tanstackNavigation = (
  router: Pick<AnyRouter, "navigate" | "subscribe">
): RadicalNavigation => ({
  navigate: (to, options) =>
    Effect.tryPromise({
      try: () => router.navigate({ to, ...options }),
      catch: (cause) => new NavigationFailed({ cause }),
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
