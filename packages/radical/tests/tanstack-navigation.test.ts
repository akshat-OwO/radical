import { assert, describe, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Clock, Deferred, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { RadicalAdapter } from "../src/adapter.ts";
import { BrowserTransitions } from "../src/client.ts";
import type { Transition } from "../src/client.ts";
import {
  browserTransitions,
  tanstackStartAdapter,
} from "../src/tanstack-start.ts";

const makeRouter = () => {
  const root = createRootRoute();
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    staticData: { radical: { transition: "slide" } },
  });
  const details = createRoute({
    getParentRoute: () => root,
    path: "/details",
    staticData: { radical: { transition: "slide" } },
  });
  const about = createRoute({
    getParentRoute: () => root,
    path: "/about",
    staticData: { radical: { transition: "fade" } },
  });
  const plain = createRoute({ getParentRoute: () => root, path: "/plain" });
  return createRouter({
    routeTree: root.addChildren([home, details, about, plain]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    origin: "http://localhost",
    defaultPendingMs: Infinity,
    defaultPendingMinMs: 0,
    isServer: false,
  });
};

const stalledNavigation = (cancel: boolean) =>
  Effect.gen(function* () {
    const router = makeRouter();
    yield* Effect.promise(async () => {
      await router.load();
    });
    const started = yield* Deferred.make<boolean>();
    const clock = yield* Effect.clockWith(Effect.succeed);
    const plans = yield* Ref.make<Transition[]>([]);
    const layer = Layer.merge(
      Layer.succeed(Clock.Clock, clock),
      Layer.succeed(BrowserTransitions, {
        start: (plan) =>
          Effect.gen(function* () {
            yield* Ref.update(plans, (items) => [...items, plan]);
            yield* Deferred.succeed(started, true);
            return Option.some({ finished: Effect.never, skip: Effect.void });
          }),
      })
    );
    const original = router.startViewTransition;
    const controller = browserTransitions(
      router,
      { timeoutMs: 100, direction: () => "back" },
      layer
    );
    const fiber = yield* Effect.forkChild(
      Effect.promise(async () => {
        await router.navigate({ to: "/details" });
      })
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust(10);
    assert.strictEqual(router.stores.resolvedLocation.get()?.pathname, "/");
    if (cancel) {
      controller.cancel();
    } else {
      yield* TestClock.adjust(90);
    }
    yield* Fiber.join(fiber);
    assert.strictEqual(router.state.location.pathname, "/details");
    assert.deepStrictEqual(yield* Ref.get(plans), [
      { kind: "slide", direction: "back" },
    ]);
    controller.dispose();
    assert.strictEqual(router.startViewTransition, original);
  });

describe("TanStack navigation", () => {
  it.effect(
    "cancels a stalled browser transition without rejecting navigation",
    () => stalledNavigation(true)
  );
  it.effect(
    "times out a stalled browser transition without blocking navigation",
    () => stalledNavigation(false)
  );
  it.effect(
    "uses route transition kinds and reverses direction on history back",
    () =>
      Effect.gen(function* () {
        const router = makeRouter();
        const plans = yield* Ref.make<Transition[]>([]);
        const clock = yield* Effect.clockWith(Effect.succeed);
        const browser = Layer.merge(
          Layer.succeed(Clock.Clock, clock),
          Layer.succeed(BrowserTransitions, {
            start: (plan, update) =>
              Effect.gen(function* () {
                yield* Ref.update(plans, (items) => [...items, plan]);
                return Option.some({
                  finished: Effect.promise(update),
                  skip: Effect.void,
                });
              }),
          })
        );
        const controller = browserTransitions(router, {}, browser);
        yield* Effect.promise(async () => {
          await router.load();
        });
        const unsubscribe = router.history.subscribe(() => {
          Effect.runFork(
            Effect.promise(async () => {
              await router.load();
            })
          );
        });
        yield* Effect.promise(async () => {
          await router.navigate({ to: "/details" });
        });
        const resolved = yield* Deferred.make<boolean>();
        const removeResolved = router.subscribe("onResolved", () => {
          Effect.runSync(Deferred.succeed(resolved, true));
        });
        router.history.back();
        yield* Deferred.await(resolved);
        removeResolved();
        yield* Effect.promise(async () => {
          await router.navigate({ to: "/about" });
        });
        yield* Effect.promise(async () => {
          await router.navigate({ to: "/plain" });
        });
        yield* Effect.promise(async () => {
          await router.navigate({ to: "/details", viewTransition: false });
        });
        assert.deepStrictEqual(yield* Ref.get(plans), [
          { kind: "slide", direction: "forward" },
          { kind: "slide", direction: "back" },
          { kind: "fade", direction: "forward" },
        ]);
        assert.strictEqual(router.state.location.pathname, "/details");
        controller.dispose();
        unsubscribe();
      })
  );

  it.effect(
    "provides navigation and unsubscribable before and after listeners",
    () =>
      Effect.gen(function* () {
        const router = makeRouter();
        yield* Effect.promise(async () => {
          await router.load();
        });
        const unsubscribe = router.history.subscribe(() => {
          Effect.runFork(
            Effect.promise(async () => {
              await router.load();
            })
          );
        });
        const adapter = yield* RadicalAdapter.pipe(
          Effect.provide(tanstackStartAdapter(router))
        );
        const navigation = yield* adapter.navigation;
        const before = yield* Ref.make<string[]>([]);
        const after: string[] = [];
        const removeBefore = yield* navigation.onBeforeNavigate((from, to) =>
          Ref.update(before, (items) => [...items, `${from}->${to}`])
        );
        const removeAfter = yield* navigation.onAfterNavigate((to) => {
          after.push(to);
        });
        yield* navigation.navigate("/details");
        assert.deepStrictEqual(yield* Ref.get(before), ["/->/details"]);
        assert.deepStrictEqual(after, ["/details"]);
        removeBefore();
        removeAfter();
        yield* navigation.navigate("/about", { replace: true });
        assert.strictEqual(router.state.location.pathname, "/about");
        assert.strictEqual(router.history.length, 2);
        assert.deepStrictEqual(yield* Ref.get(before), ["/->/details"]);
        assert.deepStrictEqual(after, ["/details"]);
        unsubscribe();
      })
  );
});
