import type { AnyRouter, RouterHistory } from "@tanstack/react-router";
import { Effect, Fiber } from "effect";
import type { Layer } from "effect";

import type { Transition } from "./browser-transitions.ts";
import { NativeTransitions, nativeTransition } from "./native-transitions.ts";
import { NavigationFailed } from "./navigation-error.ts";
import type { BrowserTransitionOptions } from "./tanstack-navigation.ts";

let overlaySequence = 0;

/** Router's commit boundary covers links, imperative navigation, and history. */
export const installNativeTransitions = (
  router: Omit<AnyRouter, "history"> & { readonly history: RouterHistory },
  options: BrowserTransitionOptions,
  native: Layer.Layer<NativeTransitions>
) => {
  const original = router.startViewTransition;
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
  const start: typeof original = (commit) => {
    const enabled = router.shouldViewTransition !== false;
    router.shouldViewTransition = undefined;
    const next = router.latestLocation;
    const previous = router.stores.resolvedLocation.get();
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
        !kind
      ) {
        return yield* update;
      }
      overlaySequence += 1;
      const id = String(overlaySequence);
      cancelOverlay = Effect.gen(function* () {
        const transitions = yield* NativeTransitions;
        yield* transitions.remove(id);
      }).pipe(
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
  };
  router.startViewTransition = start;
  return {
    cancel: () => {
      Effect.runFork(cancelOverlay);
    },
    dispose: () => {
      disposed = true;
      Effect.runFork(cancelOverlay);
      removeHistory();
      if (router.startViewTransition === start) {
        router.startViewTransition = original;
      }
    },
  };
};
