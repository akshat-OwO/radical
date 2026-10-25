import type { AnyRouter, RouterHistory } from "@tanstack/react-router";
import { Effect, Fiber } from "effect";
import type { Layer } from "effect";

import { makeBackHistory } from "../../capabilities/back/back-history.ts";
import type { BackHistoryStorage } from "../../capabilities/back/back-history.ts";
import { decideBack } from "../../capabilities/back/back.ts";
import type { Transition } from "../../capabilities/transitions/browser-transitions.ts";
import {
  NativeTransitions,
  nativeTransition,
} from "../../capabilities/transitions/native-transitions.ts";
import type { BackRequest } from "../../capabilities/transitions/native-transitions.ts";
import { NavigationFailed } from "../../core/adapter/errors.ts";
import type { BrowserTransitionOptions } from "./tanstack-navigation.ts";
import { installRouterCommitHook } from "./tanstack-router-internals.ts";
import {
  crossesSections,
  routeHidden,
  sectionBindings,
  watchSectionBinding,
} from "./tanstack-section-ownership.ts";

type NativeRouter = Omit<AnyRouter, "history"> & {
  readonly history: RouterHistory;
};

const historyIndex = (location: AnyRouter["state"]["location"] | undefined) =>
  location?.state.__TSR_index ?? 0;

/** Router's commit boundary covers links, imperative navigation, and history. */
export const installNativeTransitions = (
  router: NativeRouter,
  options: BrowserTransitionOptions,
  native: Layer.Layer<NativeTransitions>,
  storage?: BackHistoryStorage | null
) => {
  let direction: Transition["direction"] = "forward";
  // System back that selects a section replaces history but still moves back.
  let backDirection = false;
  // The shell already animated an interactive pop and waits for `settle`.
  let settlePending = false;
  let stop = Effect.void;
  let cancelOverlay = Effect.void;
  let disposed = false;
  let published = "";
  const history = makeBackHistory(storage);

  const run = <A>(effect: Effect.Effect<A, never, NativeTransitions>) =>
    Effect.runFork(effect.pipe(Effect.provide(native)));

  const decide = () => {
    const { location } = router.state;
    const index = historyIndex(location);

    return {
      index,
      decision: decideBack(
        {
          current: location.pathname,
          previous: history.previous(index),
          hidden: routeHidden(router, location.pathname),
        },
        sectionBindings.get(router) ?? null
      ),
    };
  };

  const publish = () => {
    if (disposed) {
      return;
    }

    const { location } = router.state;
    history.record(historyIndex(location), location.pathname);
    const { index, decision } = decide();

    const state = {
      handles: decision._tag !== "Exit",
      pop: decision._tag === "Pop",
      index,
    };

    const key = `${state.handles}:${state.pop}:${state.index}`;

    if (key === published) {
      return;
    }

    published = key;
    run(NativeTransitions.pipe(Effect.flatMap((n) => n.setBack(state))));
  };

  const back = ({ interactive }: BackRequest) => {
    if (disposed) {
      return;
    }

    const { decision } = decide();
    const binding = sectionBindings.get(router);

    if (decision._tag === "Pop") {
      settlePending = interactive;
      router.history.back();

      return;
    }

    if (interactive) {
      // The swipe raced a route change; restore the live page.
      run(NativeTransitions.pipe(Effect.flatMap((n) => n.settle)));
    }

    if (decision._tag === "Exit" || binding === undefined) {
      run(NativeTransitions.pipe(Effect.flatMap((n) => n.exit)));

      return;
    }

    Effect.runFork(
      binding.controller.destination(decision.id).pipe(
        Effect.flatMap((to) =>
          Effect.tryPromise({
            try: () => {
              backDirection = true;

              return router.navigate({ href: to, replace: true });
            },
            catch: (cause) => new NavigationFailed({ cause }),
          })
        ),
        Effect.ensuring(
          Effect.sync(() => {
            backDirection = false;
          })
        ),
        Effect.ignore
      )
    );
  };

  const removeHistory = router.history.subscribe(({ action }) => {
    direction =
      action.type === "BACK" || (action.type === "GO" && action.index < 0)
        ? "back"
        : "forward";
  });

  const removeResolved = router.subscribe("onResolved", publish);
  const removeBinding = watchSectionBinding(router, publish);

  const removeBack = Effect.runSync(
    NativeTransitions.pipe(
      Effect.flatMap((n) => n.onBack(back)),
      Effect.provide(native)
    )
  );

  publish();

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

      const historyDirection = backDirection ? "back" : direction;

      const selectedDirection =
        options.direction?.(historyDirection) ?? historyDirection;

      const previousStop = stop;
      const settle = settlePending;
      settlePending = false;

      const effect = Effect.gen(function* () {
        yield* previousStop;
        const transitions = yield* NativeTransitions;

        if (settle) {
          // The shell drew the pop; reveal the live page once it painted.
          return yield* update.pipe(
            Effect.tap(() => transitions.painted),
            Effect.ensuring(transitions.settle)
          );
        }

        if (
          disposed ||
          !enabled ||
          !previous ||
          previous.href === next.href ||
          crossesSections(router, previous.pathname, next.pathname) ||
          !kind
        ) {
          return yield* update;
        }

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
          options.timeoutMs,
          historyIndex(previous)
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
      removeResolved();
      removeBinding();
      removeBack();
      removeCommitHook();
    },
  };
};
