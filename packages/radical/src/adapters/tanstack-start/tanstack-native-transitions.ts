import type { AnyRouter, RouterHistory } from "@tanstack/react-router";
import { Effect, Fiber } from "effect";
import type { Layer } from "effect";

import type { Transition } from "../../capabilities/transitions/browser-transitions.ts";
import {
  NativeTransitions,
  nativeTransition,
} from "../../capabilities/transitions/native-transitions.ts";
import { NavigationFailed } from "../../core/adapter/errors.ts";
import type { BrowserTransitionOptions } from "./tanstack-navigation.ts";
import { installRouterCommitHook } from "./tanstack-router-internals.ts";
import { crossesSections } from "./tanstack-section-ownership.ts";

/** Router's commit boundary covers links, imperative navigation, and history. */
export const installNativeTransitions = (
  router: Omit<AnyRouter, "history"> & { readonly history: RouterHistory },
  options: BrowserTransitionOptions,
  native: Layer.Layer<NativeTransitions>
) => {
  let direction: Transition["direction"] = "forward";
  let stop = Effect.void;
  let cancelOverlay = Effect.void;
  let disposed = false;

  const removeHistory = router.history.subscribe(({ action }) => {
    direction =
      action.type === "BACK" || (action.type === "GO" && action.index < 0)
        ? "back"
        : "forward";
  });

  const removeCommitHook = installRouterCommitHook(
    router,
    (commit, enabled) => {
      const { location: next, resolvedLocation: previous } = router.state;

      const kind = router
        .matchRoutes(next.pathname)
        .findLast((match) => match.staticData.radical?.transition)?.staticData
        .radical?.transition;

      const update = Effect.tryPromise({
        try: commit,
        catch: (cause) => new NavigationFailed({ cause }),
      });

      const selectedDirection = options.direction?.(direction) ?? direction;
      const previousStop = stop;

      const effect = Effect.gen(function* () {
        yield* previousStop;

        if (
          disposed ||
          !enabled ||
          !previous ||
          previous.href === next.href ||
          crossesSections(router, previous.href, next.href) ||
          !kind
        ) {
          return yield* update;
        }

        const transitions = yield* NativeTransitions;
        const id = yield* transitions.nextId;
        cancelOverlay = transitions
          .remove(id)
          .pipe(
            Effect.timeout(options.timeoutMs ?? 1000),
            Effect.ignore,
            Effect.provide(native)
          );

        return yield* nativeTransition(
          id,
          { kind, direction: selectedDirection },
          update,
          options.timeoutMs
        );
      }).pipe(Effect.provide(native));

      const fiber = Effect.runFork(effect);
      // Cancelling an animation must not interrupt the router's commit.
      stop = Fiber.join(fiber).pipe(Effect.ignore);

      return Effect.runPromise(Fiber.join(fiber));
    }
  );

  return {
    cancel: () => {
      Effect.runFork(cancelOverlay);
    },
    dispose: () => {
      disposed = true;
      Effect.runFork(cancelOverlay);
      removeHistory();
      removeCommitHook();
    },
  };
};
