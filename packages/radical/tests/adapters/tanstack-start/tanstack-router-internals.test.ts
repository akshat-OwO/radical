import { assert, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { installRouterCommitHook } from "../../../src/adapters/tanstack-start/tanstack-router-internals.ts";

it.effect(
  "contracts the installed router's awaited commit hook and opt-out flag",
  () =>
    Effect.gen(function* () {
      const root = createRootRoute();
      const router = createRouter({
        routeTree: root.addChildren(
          ["/", "/details"].map((path) =>
            createRoute({ getParentRoute: () => root, path })
          )
        ),
        history: createMemoryHistory({ initialEntries: ["/"] }),
        origin: "http://localhost",
        defaultPendingMs: Infinity,
        defaultPendingMinMs: 0,
        isServer: false,
      });
      assert.isFunction(router.startViewTransition);
      yield* Effect.promise(async () => {
        await router.load();
      });
      const original = router.startViewTransition;
      // A false default must not disable native transitions. Only the explicit
      // per-navigation false flag opts out, and the hook must consume that flag.
      router.update({ defaultViewTransition: false });
      for (const viewTransition of [
        false,
        undefined,
        true,
        { types: ["host"] },
      ]) {
        const from = router.state.resolvedLocation?.pathname;
        const to = from === "/" ? "/details" : "/";
        const entered = yield* Deferred.make<boolean>();
        const capture = yield* Deferred.make<boolean>();
        const committed = yield* Deferred.make<boolean>();
        const reveal = yield* Deferred.make<boolean>();
        const loaded = yield* Deferred.make<boolean>();
        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            // Model Transitioner's history subscription so navigate does not
            // also start an implicit load alongside the explicit load below.
            const removeHistory = router.history.subscribe(() => {
              /* Loaded below. */
            });
            const removeHook = installRouterCommitHook(
              router,
              async (commit, enabled) => {
                await Effect.runPromise(
                  Effect.gen(function* () {
                    assert.isFunction(commit);
                    assert.strictEqual(enabled, viewTransition !== false);
                    assert.isUndefined(router.shouldViewTransition);
                    assert.strictEqual(router.state.location.pathname, to);
                    assert.strictEqual(
                      router.state.resolvedLocation?.pathname,
                      from
                    );
                    yield* Deferred.succeed(entered, true);
                    yield* Deferred.await(capture);
                    yield* Effect.promise(commit);
                    assert.strictEqual(
                      router.state.resolvedLocation?.pathname,
                      to
                    );
                    yield* Deferred.succeed(committed, true);
                    yield* Deferred.await(reveal);
                  })
                );
              }
            );
            return () => {
              removeHook();
              removeHistory();
            };
          }),
          () =>
            Effect.gen(function* () {
              const navigation = router.navigate({ to, viewTransition });
              const load = yield* Effect.promise(async () => {
                await router.load();
              }).pipe(
                Effect.andThen(Deferred.succeed(loaded, true)),
                Effect.forkChild
              );
              yield* Deferred.await(entered);
              yield* TestClock.adjust(1000);
              assert.strictEqual(router.state.matches.at(-1)?.pathname, from);
              assert.isFalse(yield* Deferred.isDone(loaded));
              yield* Deferred.succeed(capture, true);
              yield* Deferred.await(committed);
              yield* TestClock.adjust(1000);
              assert.strictEqual(router.state.matches.at(-1)?.pathname, to);
              assert.isFalse(yield* Deferred.isDone(loaded));
              yield* Deferred.succeed(reveal, true);
              yield* Fiber.join(load);
              yield* Effect.promise(async () => {
                await navigation;
              });
            }),
          (remove) => Effect.sync(remove)
        );
        assert.strictEqual(router.startViewTransition, original);
      }
    })
);
