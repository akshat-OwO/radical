import { defaultParseSearch } from "@tanstack/react-router";
import type { AnyRouter, RouterHistory } from "@tanstack/react-router";
import { Effect, Fiber, Layer } from "effect";

import type { RadicalNavigation } from "./adapter.ts";
import { BridgeLive } from "./bridge.ts";
import {
  BrowserTransitionsLive,
  cancelBrowserTransition,
  watchBrowserTransition,
} from "./browser-transitions.ts";
import type { BrowserTransitions, Transition } from "./browser-transitions.ts";
import { NativeTransitionsLive } from "./native-transitions.ts";
import { NavigationFailed } from "./navigation-error.ts";
import { installNativeTransitions } from "./tanstack-native-transitions.ts";
import { transitionStrategy } from "./transition-strategy.ts";

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
  router: Pick<AnyRouter, "navigate" | "subscribe" | "options">
): RadicalNavigation => ({
  navigate: (to, options) =>
    Effect.tryPromise({
      try: () => {
        const hashIndex = to.indexOf("#");
        const path = hashIndex === -1 ? to : to.slice(0, hashIndex);
        const hash = hashIndex === -1 ? "" : to.slice(hashIndex + 1);
        const searchIndex = path.indexOf("?");
        const pathname = searchIndex === -1 ? path : path.slice(0, searchIndex);
        const query = searchIndex === -1 ? "" : path.slice(searchIndex);
        return router.navigate({
          to: pathname,
          search: (router.options.parseSearch ?? defaultParseSearch)(query),
          hash,
          ...options,
        });
      },
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
