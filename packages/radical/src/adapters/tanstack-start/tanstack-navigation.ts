import type { AnyRouter, RouterHistory } from "@tanstack/react-router";
import { Effect, Fiber, Layer } from "effect";

import {
  BrowserTransitionsLive,
  cancelBrowserTransition,
  watchBrowserTransition,
} from "../../capabilities/transitions/browser-transitions.ts";
import type {
  BrowserTransitions,
  Transition,
} from "../../capabilities/transitions/browser-transitions.ts";
import { NativeTransitionsLive } from "../../capabilities/transitions/native-transitions.ts";
import { transitionStrategy } from "../../capabilities/transitions/transition-strategy.ts";
import type { RadicalNavigation } from "../../core/adapter/adapter.ts";
import { NavigationFailed } from "../../core/adapter/errors.ts";
import { BridgeLive } from "../../core/bridge/bridge.ts";
import { internalNavigationOptions } from "./tanstack-internal-navigation.ts";
import { installNativeTransitions } from "./tanstack-native-transitions.ts";
import { crossesSections } from "./tanstack-section-ownership.ts";

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

  const strategy = Effect.runSync(
    transitionStrategy.pipe(Effect.provide(Layer.merge(browser, BridgeLive)))
  );

  if (strategy === "native") {
    return installNativeTransitions(
      router,
      options,
      NativeTransitionsLive.pipe(Layer.provide(BridgeLive))
    );
  }

  if (strategy === "plain") {
    return {
      cancel: () => {
        /* No transition was installed. */
      },
      dispose: () => {
        /* No subscriptions were installed. */
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
          fromLocation.href === toLocation.href ||
          crossesSections(router, fromLocation.pathname, toLocation.pathname)
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
  router: Pick<AnyRouter, "navigate" | "subscribe" | "options">
): RadicalNavigation => ({
  navigate: (to, options) =>
    Effect.tryPromise({
      try: () =>
        router.navigate({
          ...internalNavigationOptions(router, to),
          ...options,
        }),
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
