import { assert, describe, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Clock, Deferred, Effect, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { RadicalAdapter } from "../src/adapter.ts";
import { BrowserTransitions } from "../src/client.ts";
import { tanstackNavigation } from "../src/tanstack-navigation.ts";
import {
  browserTransitions,
  tanstackStartAdapterLayer,
} from "../src/tanstack-start-client.ts";

/** A browser with typed view-transition selectors and no active transition. */
const typedBrowser = (supportsTypes = true) =>
  Layer.succeed(BrowserTransitions, {
    supportsTypes: Effect.succeed(supportsTypes),
    active: Effect.succeed(Option.none()),
  });

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

const transitionTypes = (
  router: ReturnType<typeof makeRouter>,
  from: string | undefined,
  to: string
) => {
  const option = router.options.defaultViewTransition;
  assert.isObject(option);
  assert.isTrue(typeof option === "object");
  if (typeof option !== "object") {
    return false;
  }
  assert.isFunction(option.types);
  if (typeof option.types !== "function") {
    return false;
  }
  return option.types({
    fromLocation:
      from === undefined ? undefined : router.buildLocation({ to: from }),
    toLocation: router.buildLocation({ to }),
    pathChanged: from !== to,
    hrefChanged: from !== to,
    hashChanged: false,
  });
};

describe("TanStack navigation", () => {
  it.effect(
    "does not install browser transitions during server rendering",
    () =>
      Effect.sync(() => {
        const router = createRouter({
          routeTree: createRootRoute(),
          isServer: true,
        });
        const original = router.options.defaultViewTransition;
        const controller = browserTransitions(router);
        controller.cancel();
        controller.dispose();
        assert.strictEqual(router.options.defaultViewTransition, original);
      })
  );
  it.effect(
    "selects route types through public options and history actions",
    () =>
      Effect.sync(() => {
        const router = makeRouter();
        const original = router.options.defaultViewTransition;
        const controller = browserTransitions(router, {}, typedBrowser());
        assert.strictEqual(transitionTypes(router, undefined, "/"), false);
        assert.strictEqual(transitionTypes(router, "/", "/"), false);
        assert.strictEqual(transitionTypes(router, "/", "/plain"), false);
        router.history.push("/details");
        assert.deepStrictEqual(transitionTypes(router, "/", "/details"), [
          "radical-slide",
          "radical-forward",
        ]);
        router.history.back();
        assert.deepStrictEqual(transitionTypes(router, "/details", "/"), [
          "radical-slide",
          "radical-back",
        ]);
        router.history.forward();
        assert.deepStrictEqual(transitionTypes(router, "/", "/about"), [
          "radical-fade",
          "radical-forward",
        ]);
        router.history.go(-1);
        assert.deepStrictEqual(transitionTypes(router, "/about", "/"), [
          "radical-slide",
          "radical-back",
        ]);
        router.history.go(1);
        assert.deepStrictEqual(transitionTypes(router, "/", "/details"), [
          "radical-slide",
          "radical-forward",
        ]);
        router.history.replace("/about");
        assert.deepStrictEqual(transitionTypes(router, "/details", "/about"), [
          "radical-fade",
          "radical-forward",
        ]);
        controller.dispose();
        assert.strictEqual(router.options.defaultViewTransition, original);
      })
  );

  it.effect("supports a direction override and restores previous options", () =>
    Effect.sync(() => {
      const router = makeRouter();
      const original = { types: ["host"] };
      router.update({ defaultViewTransition: original });
      const controller = browserTransitions(
        router,
        { direction: () => "back" },
        typedBrowser()
      );
      assert.deepStrictEqual(transitionTypes(router, "/", "/details"), [
        "radical-slide",
        "radical-back",
      ]);
      controller.dispose();
      assert.strictEqual(router.options.defaultViewTransition, original);
    })
  );

  it.effect(
    "keeps plain navigation where transition types are unsupported",
    () =>
      Effect.sync(() => {
        const router = makeRouter();
        const original = router.options.defaultViewTransition;
        const controller = browserTransitions(router, {}, typedBrowser(false));
        assert.strictEqual(router.options.defaultViewTransition, original);
        controller.dispose();
        assert.strictEqual(router.options.defaultViewTransition, original);
      })
  );

  it.effect(
    "navigates without browser support and provides unsubscribable listeners",
    () =>
      Effect.gen(function* () {
        const router = makeRouter();
        const controller = browserTransitions(router);
        const removeLoad = router.history.subscribe(() => {
          Effect.runFork(
            Effect.promise(async () => {
              await router.load();
            })
          );
        });
        yield* Effect.promise(async () => {
          await router.load();
        });
        const adapter = yield* RadicalAdapter.pipe(
          Effect.provide(tanstackStartAdapterLayer(router))
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
        assert.strictEqual(router.state.location.pathname, "/details");
        assert.deepStrictEqual(yield* Ref.get(before), ["/->/details"]);
        assert.deepStrictEqual(after, ["/details"]);
        removeBefore();
        removeAfter();
        yield* navigation.navigate("/about", { replace: true });
        assert.strictEqual(router.state.location.pathname, "/about");
        assert.strictEqual(router.history.length, 2);
        assert.deepStrictEqual(after, ["/details"]);
        controller.dispose();
        removeLoad();
      })
  );

  it.effect(
    "resolves navigation while animation is stalled and skips on timeout",
    () =>
      Effect.gen(function* () {
        const router = makeRouter();
        const removeLoad = router.history.subscribe(() => {
          Effect.runFork(
            Effect.promise(async () => {
              await router.load();
            })
          );
        });
        yield* Effect.promise(async () => {
          await router.load();
        });
        const started = yield* Deferred.make<boolean>();
        const skipped = yield* Deferred.make<boolean>();
        const clock = yield* Effect.clockWith(Effect.succeed);
        const browser = Layer.merge(
          Layer.succeed(BrowserTransitions, {
            supportsTypes: Effect.succeed(true),
            active: Deferred.succeed(started, true).pipe(
              Effect.as(
                Option.some({
                  finished: Effect.never,
                  skip: Deferred.succeed(skipped, true).pipe(Effect.asVoid),
                })
              )
            ),
          }),
          Layer.succeed(Clock.Clock, clock)
        );
        const controller = browserTransitions(
          router,
          { timeoutMs: 100 },
          browser
        );
        yield* Effect.promise(async () => {
          await router.navigate({ to: "/details" });
        });
        yield* Deferred.await(started);
        assert.strictEqual(router.state.location.pathname, "/details");
        assert.isFalse(yield* Deferred.isDone(skipped));
        yield* TestClock.adjust(100);
        yield* Deferred.await(skipped);
        controller.dispose();
        removeLoad();
      })
  );

  it.effect(
    "preserves navigation failures as NavigationFailed with their cause",
    () =>
      Effect.gen(function* () {
        const cause = new Error("navigation failed");
        const router = makeRouter();
        const navigation = tanstackNavigation({
          subscribe: router.subscribe,
          navigate: async () => {
            await Promise.reject(cause);
          },
        });
        const error = yield* Effect.flip(navigation.navigate("/details"));
        assert.strictEqual(error._tag, "NavigationFailed");
        if (error._tag === "NavigationFailed") {
          assert.strictEqual(error.cause, cause);
        }
      })
  );
});
