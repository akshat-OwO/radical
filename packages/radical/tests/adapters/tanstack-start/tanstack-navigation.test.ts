import { assert, describe, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Clock, Deferred, Effect, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { installNativeTransitions } from "../../../src/adapters/tanstack-start/tanstack-native-transitions.ts";
import { tanstackNavigation } from "../../../src/adapters/tanstack-start/tanstack-navigation.ts";
import {
  browserTransitions,
  tanstackStartAdapterLayer,
} from "../../../src/adapters/tanstack-start/tanstack-start-client.ts";
import { NativeTransitions } from "../../../src/capabilities/transitions/native-transitions.ts";
import { RadicalAdapter } from "../../../src/core/adapter/adapter.ts";
import { BrowserTransitions } from "../../../src/entry/client.ts";

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
  it.effect("splits pathname, search, and hash before calling TanStack", () =>
    Effect.gen(function* () {
      const router = makeRouter();
      const calls: unknown[] = [];
      const navigation = tanstackNavigation({
        options: router.options,
        subscribe: router.subscribe,
        navigate: async (options) => {
          calls.push(options);
          await Effect.runPromise(Effect.void);
        },
      });
      yield* navigation.navigate("/details?item=1&name=hello%20world#x", {
        replace: true,
      });
      yield* navigation.navigate("/about");
      assert.deepStrictEqual(calls, [
        {
          to: "/details",
          search: { item: 1, name: "hello world" },
          hash: "x",
          replace: true,
        },
        { to: "/about", search: {}, hash: "" },
      ]);
    })
  );

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
        yield* navigation.navigate("/details?item=1#x");
        assert.strictEqual(router.state.location.pathname, "/details");
        assert.deepStrictEqual(router.state.location.search, { item: 1 });
        assert.strictEqual(router.state.location.hash, "x");
        assert.deepStrictEqual(yield* Ref.get(before), [
          "/->/details?item=1#x",
        ]);
        assert.deepStrictEqual(after, ["/details?item=1#x"]);
        removeBefore();
        removeAfter();
        yield* navigation.navigate("/about", { replace: true });
        assert.strictEqual(router.state.location.pathname, "/about");
        assert.strictEqual(router.history.length, 2);
        assert.deepStrictEqual(after, ["/details?item=1#x"]);
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
          options: router.options,
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

it.effect(
  "uses native capture for router navigation without browser support",
  () =>
    Effect.gen(function* () {
      const router = makeRouter();
      yield* Effect.promise(async () => {
        await router.load();
      });
      const calls: string[] = [];
      const original = router.startViewTransition;
      const controller = installNativeTransitions(
        router,
        {},
        Layer.succeed(NativeTransitions, {
          cover: () =>
            Effect.sync(() => {
              calls.push(`cover:${router.state.resolvedLocation?.pathname}`);
            }),
          painted: Effect.sync(() => {
            calls.push(`painted:${router.state.location.pathname}`);
          }),
          reveal: (_id, transition) =>
            Effect.sync(() => {
              calls.push(`${transition.kind}:${transition.direction}`);
            }),
          remove: () =>
            Effect.sync(() => {
              calls.push("remove");
            }),
        })
      );
      const navigate = (to: string) =>
        Effect.promise(async () => {
          const navigation = router.navigate({ to });
          void router.load();
          await navigation;
        });
      yield* navigate("/details");
      assert.deepStrictEqual(calls, [
        "cover:/",
        "painted:/details",
        "slide:forward",
        "remove",
      ]);
      calls.length = 0;
      yield* navigate("/about");
      assert.deepStrictEqual(calls, [
        "cover:/details",
        "painted:/about",
        "fade:forward",
        "remove",
      ]);
      calls.length = 0;
      router.history.back();
      yield* Effect.promise(async () => {
        await router.load();
      });
      assert.deepStrictEqual(calls, [
        "cover:/about",
        "painted:/details",
        "slide:back",
        "remove",
      ]);
      calls.length = 0;
      yield* Effect.promise(async () => {
        const navigation = router.navigate({
          to: "/about",
          viewTransition: false,
        });
        void router.load();
        await navigation;
      });
      assert.deepStrictEqual(calls, []);
      controller.dispose();
      assert.strictEqual(router.startViewTransition, original);
    })
);

it.effect("commits plain and native routes without crypto.randomUUID", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: { randomUUID: undefined },
      });
      return descriptor;
    }),
    () =>
      Effect.gen(function* () {
        assert.isUndefined(Reflect.get(globalThis.crypto, "randomUUID"));
        const router = makeRouter();
        const ids: string[] = [];
        const clock = yield* Effect.clockWith(Effect.succeed);
        const controller = installNativeTransitions(
          router,
          {},
          Layer.merge(
            Layer.succeed(Clock.Clock, clock),
            Layer.succeed(NativeTransitions, {
              cover: (id) =>
                Effect.sync(() => {
                  ids.push(id);
                }),
              painted: Effect.void,
              reveal: () => Effect.void,
              remove: () => Effect.void,
            })
          )
        );
        yield* Effect.promise(async () => {
          await router.load();
        });
        assert.deepStrictEqual(ids, []);
        for (const to of ["/details", "/plain", "/about"] as const) {
          yield* Effect.promise(async () => {
            const navigation = router.navigate({ to });
            await router.load();
            await navigation;
          });
          assert.strictEqual(router.state.location.pathname, to);
        }
        assert.strictEqual(ids.length, 2);
        assert.strictEqual(ids[1], String(Number(ids[0]) + 1));
        yield* Effect.promise(async () => {
          const navigation = router.navigate({
            to: "/",
            viewTransition: false,
          });
          await router.load();
          await navigation;
        });
        assert.strictEqual(router.state.location.pathname, "/");
        assert.strictEqual(ids.length, 2);
        controller.dispose();
      }),
    (descriptor) =>
      Effect.sync(() => {
        if (descriptor) {
          Object.defineProperty(globalThis, "crypto", descriptor);
        } else {
          Reflect.deleteProperty(globalThis, "crypto");
        }
      })
  )
);
