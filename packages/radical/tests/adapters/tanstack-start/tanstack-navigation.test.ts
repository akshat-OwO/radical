import { assert, describe, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Clock, Deferred, Effect, Layer, Option, Ref, Predicate } from "effect";
import { TestClock } from "effect/testing";

import { installNativeTransitions } from "../../../src/adapters/tanstack-start/tanstack-native-transitions.ts";
import { tanstackNavigation } from "../../../src/adapters/tanstack-start/tanstack-navigation.ts";
import { tanstackSections } from "../../../src/adapters/tanstack-start/tanstack-sections.ts";
import {
  browserTransitions,
  tanstackStartAdapterLayer,
} from "../../../src/adapters/tanstack-start/tanstack-start-client.ts";
import {
  NativeTransitions,
  NativeTransitionsLive,
} from "../../../src/capabilities/transitions/native-transitions.ts";
import { RadicalAdapter } from "../../../src/core/adapter/adapter.ts";
import { bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";
import type { Bridge } from "../../../src/core/bridge/bridge.ts";
import { BrowserTransitions } from "../../../src/entry/client.ts";
import { ignoredBack } from "../../fixtures/native-back.ts";

/** A browser with typed view-transition selectors and no active transition. */
const typedBrowser = (supportsTypes = true) =>
  Layer.succeed(BrowserTransitions, {
    supportsTypes: Effect.succeed(supportsTypes),
    active: Effect.succeed(Option.none()),
  });

/** Keep live id allocation and command decoding without browser paint frames. */
const nativeTestLayer = (call: Bridge["Service"]["call"]) =>
  Layer.effect(
    NativeTransitions,
    Effect.gen(function* () {
      const service = yield* NativeTransitions;

      return { ...service, painted: Effect.void };
    })
  ).pipe(
    Layer.provide(
      NativeTransitionsLive.pipe(Layer.provide(bridgeTestLayer("ios", call)))
    )
  );

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
  assert.isTrue(Predicate.isObjectKeyword(option));

  if (!Predicate.isObjectKeyword(option)) {
    return false;
  }

  assert.isFunction(option.types);

  if (option.types === undefined || Array.isArray(option.types)) {
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
          ...ignoredBack,
          nextId: Effect.succeed("one"),
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
        assert.isFalse(
          "randomUUID" in globalThis.crypto &&
            globalThis.crypto.randomUUID !== undefined
        );
        const router = makeRouter();
        const ids: string[] = [];
        const clock = yield* Effect.clockWith(Effect.succeed);

        const controller = installNativeTransitions(
          router,
          {},
          Layer.merge(
            Layer.succeed(Clock.Clock, clock),
            nativeTestLayer((_plugin, method, options) =>
              Effect.sync(() => {
                if (method === "cover") {
                  ids.push(String(options.id));
                }

                return { id: options.id };
              })
            )
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

it.effect("keeps overlay ids unique across routers and reinstallations", () =>
  Effect.gen(function* () {
    const first = makeRouter();
    const second = makeRouter();
    const ids = yield* Ref.make<string[]>([]);
    const staleId = yield* Ref.make("");
    const removing = yield* Deferred.make<boolean>();
    const releaseRemove = yield* Deferred.make<boolean>();
    const removed = yield* Deferred.make<boolean>();
    const clock = yield* Effect.clockWith(Effect.succeed);

    const native = nativeTestLayer((_plugin, method, options) =>
      Effect.gen(function* () {
        if (method === "cover") {
          yield* Ref.update(ids, (values) => [...values, String(options.id)]);
        }

        if (method === "remove" && options.id === (yield* Ref.get(staleId))) {
          yield* Deferred.succeed(removing, true);
          yield* Deferred.await(releaseRemove);
          yield* Deferred.succeed(removed, true);
        }

        return { id: options.id };
      })
    );

    const install = (router: ReturnType<typeof makeRouter>) =>
      installNativeTransitions(
        router,
        {},
        Layer.merge(native, Layer.succeed(Clock.Clock, clock))
      );

    const controllers: ReturnType<typeof install>[] = [];
    yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        controllers.push(install(first), install(second));
      }),
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await first.load();
          });
          yield* Effect.promise(async () => {
            await second.load();
          });

          for (const [router, to] of [
            [first, "/details"],
            [second, "/about"],
            [first, "/about"],
            [second, "/details"],
          ] as const) {
            const navigation = router.navigate({ to });
            yield* Effect.promise(async () => {
              await router.load();
            });
            yield* Effect.promise(async () => {
              await navigation;
            });
          }

          const beforeReinstall = yield* Ref.get(ids);
          assert.strictEqual(new Set(beforeReinstall).size, 4);
          yield* Ref.set(staleId, beforeReinstall[2]);
          controllers[0].dispose();
          yield* Deferred.await(removing);
          controllers.push(install(first));
          const navigation = first.navigate({ to: "/details" });
          yield* Effect.promise(async () => {
            await first.load();
          });
          yield* Effect.promise(async () => {
            await navigation;
          });
          const captured = yield* Ref.get(ids);
          assert.strictEqual(captured.length, 5);
          assert.strictEqual(new Set(captured).size, 5);
          assert.isFalse(yield* Deferred.isDone(removed));
          yield* Deferred.succeed(releaseRemove, true);
          yield* Deferred.await(removed);
        }),
      () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(releaseRemove, true);

          for (const controller of controllers) {
            controller.dispose();
          }
        })
    );
  })
);

it.effect(
  "skips browser transitions across sections and retains in-section route types",
  () =>
    Effect.sync(() => {
      const router = makeRouter();
      tanstackSections(router, [
        {
          id: "home",
          title: "Home",
          route: "/",
          icon: { ios: "house", android: "home.svg" },
        },
        {
          id: "about",
          title: "About",
          route: "/about",
          icon: { ios: "info.circle", android: "about.svg" },
        },
      ]);

      const controller = browserTransitions(router, {}, typedBrowser());

      assert.strictEqual(transitionTypes(router, "/details", "/about"), false);

      assert.strictEqual(transitionTypes(router, "/about", "/details"), false);

      assert.deepStrictEqual(transitionTypes(router, "/", "/details"), [
        "radical-slide",
        "radical-forward",
      ]);
      controller.dispose();
    })
);

it.effect(
  "skips native capture across sections but keeps in-section transitions",
  () =>
    Effect.gen(function* () {
      const router = makeRouter();

      yield* Effect.promise(async () => {
        await router.load();
      });
      tanstackSections(router, [
        {
          id: "home",
          title: "Home",
          route: "/",
          icon: { ios: "house", android: "home.svg" },
        },
        {
          id: "about",
          title: "About",
          route: "/about",
          icon: { ios: "info.circle", android: "about.svg" },
        },
      ]);

      const captures: string[] = [];

      const controller = installNativeTransitions(
        router,
        {},
        Layer.succeed(NativeTransitions, {
          ...ignoredBack,
          nextId: Effect.succeed("section"),
          cover: () =>
            Effect.sync(() => {
              captures.push(router.state.location.pathname);
            }),
          painted: Effect.void,
          reveal: () => Effect.void,
          remove: () => Effect.void,
        })
      );

      const navigate = (to: string) =>
        Effect.promise(async () => {
          const pending = router.navigate({ to });
          void router.load();

          await pending;
        });

      yield* navigate("/details");

      assert.deepStrictEqual(captures, ["/details"]);

      yield* navigate("/about");

      yield* navigate("/");

      assert.deepStrictEqual(captures, ["/details"]);
      controller.dispose();
    })
);
