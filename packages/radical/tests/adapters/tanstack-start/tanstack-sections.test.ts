import { assert, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { AnyRouter } from "@tanstack/react-router";
import { Effect, Layer } from "effect";

import { installNativeTransitions } from "../../../src/adapters/tanstack-start/tanstack-native-transitions.ts";
import { installRouterCommitHook } from "../../../src/adapters/tanstack-start/tanstack-router-internals.ts";
import { crossesSections } from "../../../src/adapters/tanstack-start/tanstack-section-ownership.ts";
import { tanstackSections } from "../../../src/adapters/tanstack-start/tanstack-sections.ts";
import { NativeTransitions } from "../../../src/capabilities/transitions/native-transitions.ts";
import type { Bridge } from "../../../src/core/bridge/bridge.ts";
import { bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";
import { validateConfig } from "../../../src/vite/config.ts";
import { ignoredBack } from "../../fixtures/native-back.ts";

const sections = [
  {
    id: "home",
    title: "Home",
    route: "/home",
    icon: { ios: "house", android: "home.svg" },
  },
  {
    id: "inbox",
    title: "Inbox",
    route: "/inbox",
    icon: { ios: "tray", android: "inbox.svg" },
  },
];

const makeRouter = () => {
  const root = createRootRoute();

  const routes = [
    "/home",
    "/home/details",
    "/home/private",
    "/inbox",
    "/inbox/message",
    "/login",
  ].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      staticData: {
        radical: {
          navigation: path === "/home/private" ? "hidden" : undefined,
          transition: "slide",
        },
      },
    })
  );

  return createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({
      initialEntries: ["/home/details?q=1#anchor"],
    }),
    origin: "http://localhost",
    defaultPendingMs: Infinity,
    defaultPendingMinMs: 0,
    isServer: false,
  });
};

const navigate = (router: AnyRouter, to: string) =>
  Effect.promise(async () => {
    const pending = router.navigate({ to });
    void router.load();

    await pending;
  });

it.effect(
  "tracks resolved routes, hidden static data and selection without transitions",
  () =>
    Effect.gen(function* () {
      const router = makeRouter();

      yield* Effect.promise(async () => {
        await router.load();
      });

      const enabled: boolean[] = [];

      const removeCommit = installRouterCommitHook(
        router,
        async (commit, transition) => {
          enabled.push(transition);

          await commit();
        }
      );

      const binding = tanstackSections(router, sections);

      const remove = yield* binding.mount.pipe(
        Effect.provide(
          bridgeTestLayer("browser", () =>
            Effect.sync(() => assert.fail("Browser called native navigation"))
          )
        )
      );

      const { controller } = binding;

      assert.strictEqual(controller.snapshot().active?.id, "home");

      yield* navigate(router, "/home/private");

      assert.isTrue(controller.snapshot().hidden);

      assert.isNull(controller.snapshot().active);

      yield* navigate(router, "/login");

      assert.isTrue(controller.snapshot().hidden);

      yield* navigate(router, "/home/details?q=2#last");

      yield* Effect.promise(async () => {
        const pending = Effect.runPromise(controller.select("inbox"));
        void router.load();
        await pending;
      });

      assert.strictEqual(router.state.location.pathname, "/inbox");

      assert.strictEqual(enabled.at(-1), false);

      yield* navigate(router, "/inbox/message");

      yield* Effect.promise(async () => {
        const pending = Effect.runPromise(controller.select("home"));
        void router.load();
        await pending;
      });

      assert.strictEqual(router.state.location.href, "/home/details?q=2#last");

      yield* Effect.promise(async () => {
        const pending = Effect.runPromise(controller.select("home"));
        void router.load();
        await pending;
      });

      assert.strictEqual(router.state.location.pathname, "/home");

      assert.strictEqual(enabled.at(-1), false);

      assert.isTrue(crossesSections(router, "/home/details", "/inbox"));

      assert.isFalse(crossesSections(router, "/home", "/home/details"));

      assert.isFalse(crossesSections(router, "/home", "/login"));

      remove();

      yield* navigate(router, "/inbox");

      assert.strictEqual(controller.snapshot().active?.id, "home");
      removeCommit();
    })
);

it.effect(
  "sends native state and badges, accepts selection intents and removes bridge listeners",
  () =>
    Effect.gen(function* () {
      const router = makeRouter();

      yield* Effect.promise(async () => {
        await router.load();
      });

      const binding = tanstackSections(router, sections);

      const updates: unknown[] = [];

      let receive: Parameters<Bridge["Service"]["observe"]>[1] | undefined;

      let removed = false;

      const layer = bridgeTestLayer(
        "ios",
        (plugin, method, options) =>
          Effect.sync(() => {
            assert.strictEqual(plugin, "RadicalNavigation");

            assert.strictEqual(method, "update");
            updates.push(options);

            return {};
          }),
        (event, listener) =>
          Effect.sync(() => {
            assert.strictEqual(event, "radicalSectionSelect");
            receive = listener;

            return () => {
              removed = true;
            };
          })
      );

      const remove = yield* binding.mount.pipe(Effect.provide(layer));

      assert.deepStrictEqual(updates[0], binding.controller.snapshot());

      yield* binding.controller.setBadge("inbox", "New");

      assert.deepStrictEqual(updates.at(-1), binding.controller.snapshot());

      receive?.({ id: 42 });

      receive?.({ id: "missing" });

      assert.strictEqual(router.state.location.pathname, "/home/details");

      receive?.({ id: "inbox" });

      yield* Effect.promise(async () => {
        await router.load();
      });

      assert.strictEqual(router.state.location.pathname, "/inbox");

      assert.strictEqual(binding.controller.snapshot().active?.id, "inbox");

      remove();

      assert.isTrue(removed);

      const count = updates.length;

      yield* binding.controller.setBadge("inbox", null);

      assert.lengthOf(updates, count);
    })
);

const ownershipRouter = (
  route: string,
  entry: string,
  caseSensitive?: boolean
) => {
  const root = createRootRoute();

  const routes = [route, `${route}/item`, "/other"].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      staticData: { radical: { transition: "slide" } },
    })
  );

  return createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [entry] }),
    origin: "http://localhost",
    defaultPendingMs: Infinity,
    defaultPendingMinMs: 0,
    isServer: false,
    caseSensitive,
  });
};

for (const fixture of [
  {
    name: "decoded non-ASCII declaration",
    declaration: "/café",
    route: "/café",
    path: "/caf%C3%A9/item",
    pathname: "/café/item",
  },
  {
    name: "percent-encoded declaration",
    declaration: "/caf%C3%A9",
    route: "/café",
    path: "/caf%C3%A9/item",
    pathname: "/café/item",
  },
  {
    name: "mixed encoding and case",
    declaration: "/%43aF%c3%a9",
    route: "/café",
    path: "/caf%C3%A9/item",
    pathname: "/café/item",
  },
  {
    name: "reserved slash escape",
    declaration: "/a%2Fb",
    route: "/a%2Fb",
    path: "/a%2Fb/item",
    pathname: "/a%2Fb/item",
  },
  {
    name: "encoded space",
    declaration: "/hello%20world",
    route: "/hello world",
    path: "/hello%20world/item",
    pathname: "/hello world/item",
  },
  {
    name: "protected percent escape",
    declaration: "/caf%25C3%25A9",
    route: "/caf%25C3%25A9",
    path: "/caf%25C3%25A9/item",
    pathname: "/caf%25C3%25A9/item",
  },
  {
    name: "malformed escape",
    declaration: "/caf%ZZ",
    route: "/caf%ZZ",
    path: "/caf%ZZ/item",
    pathname: "/caf%ZZ/item",
  },
  {
    name: "default case-insensitive",
    declaration: "/inbox",
    route: "/inbox",
    path: "/Inbox/item",
    pathname: "/Inbox/item",
  },
]) {
  it.effect(
    `uses router path ownership for ${fixture.name} routes and preserves their full URLs`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const original = `${fixture.path}?q=1#anchor`;
          const router = ownershipRouter(fixture.route, original);
          yield* Effect.promise(async () => {
            await router.load();
          });
          assert.strictEqual(router.state.location.pathname, fixture.pathname);
          assert.strictEqual(
            router.state.matches.at(-1)?.routeId,
            `${fixture.route}/item`
          );

          const declarations = [
            {
              id: "primary",
              title: "Primary",
              route: fixture.declaration,
              icon: { ios: "tray", android: "primary.svg" },
            },
            {
              id: "other",
              title: "Other",
              route: "/other",
              icon: { ios: "house", android: "other.svg" },
            },
          ];

          yield* validateConfig({
            appId: "dev.test.app",
            navigation: { sections: declarations },
          });

          const binding = tanstackSections(router, declarations);
          yield* Effect.acquireRelease(
            binding.mount.pipe(
              Effect.provide(bridgeTestLayer("browser", () => Effect.void))
            ),
            (remove) => Effect.sync(remove)
          );
          assert.strictEqual(
            binding.controller.snapshot().active?.id,
            "primary"
          );
          assert.isFalse(binding.controller.snapshot().hidden);
          assert.isTrue(
            crossesSections(router, router.state.location.pathname, "/other")
          );
          assert.isFalse(
            crossesSections(
              router,
              router.state.location.pathname,
              fixture.route
            )
          );
          const captures: string[] = [];
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              installNativeTransitions(
                router,
                {},
                Layer.succeed(NativeTransitions, {
                  ...ignoredBack,
                  nextId: Effect.succeed("ownership"),
                  cover: () =>
                    Effect.sync(() => {
                      captures.push(router.state.location.href);
                    }),
                  painted: Effect.void,
                  reveal: () => Effect.void,
                  remove: () => Effect.void,
                })
              )
            ),
            (transitions) => Effect.sync(transitions.dispose)
          );
          yield* navigate(router, "/other");
          assert.isEmpty(captures);
          assert.strictEqual(binding.controller.snapshot().active?.id, "other");

          const select = () =>
            Effect.promise(async () => {
              const pending = Effect.runPromise(
                binding.controller.select("primary")
              );

              void router.load();
              await pending;
            });

          yield* select();
          assert.strictEqual(router.state.location.href, original);
          assert.strictEqual(
            binding.controller.snapshot().active?.id,
            "primary"
          );
          const updated = `${fixture.path}?q=2#last`;
          yield* navigate(router, updated);
          assert.deepStrictEqual(captures, [updated]);
          yield* navigate(router, "/other");
          assert.deepStrictEqual(captures, [updated]);
          yield* select();
          assert.strictEqual(router.state.location.href, updated);
          assert.strictEqual(
            binding.controller.snapshot().active?.id,
            "primary"
          );
          assert.isFalse(binding.controller.snapshot().hidden);
          assert.strictEqual(
            binding.controller.snapshot().active?.route,
            fixture.declaration
          );
          yield* select();
          assert.strictEqual(
            router.state.matches.at(-1)?.routeId,
            fixture.route
          );
        })
      )
  );
}

it.effect("honors explicit case-sensitive router ownership", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const router = ownershipRouter("/Inbox", "/Inbox/item?q=1#anchor", true);
      yield* Effect.promise(async () => {
        await router.load();
      });
      assert.strictEqual(router.state.matches.at(-1)?.routeId, "/Inbox/item");

      const binding = tanstackSections(router, [
        {
          id: "inbox",
          title: "Inbox",
          route: "/inbox",
          icon: { ios: "tray", android: "inbox.svg" },
        },
        {
          id: "other",
          title: "Other",
          route: "/other",
          icon: { ios: "house", android: "other.svg" },
        },
      ]);

      yield* Effect.acquireRelease(
        binding.mount.pipe(
          Effect.provide(bridgeTestLayer("browser", () => Effect.void))
        ),
        (remove) => Effect.sync(remove)
      );
      assert.isNull(binding.controller.snapshot().active);
      assert.isTrue(binding.controller.snapshot().hidden);
      assert.isFalse(
        crossesSections(router, router.state.location.pathname, "/other")
      );
      yield* navigate(router, "/other");
      yield* Effect.promise(async () => {
        const pending = Effect.runPromise(binding.controller.select("inbox"));
        void router.load();
        await pending;
      });
      assert.strictEqual(router.state.location.href, "/inbox");
    })
  )
);

for (const kind of ["basepath", "custom input rewrite"] as const) {
  it.effect(
    `keeps section declarations in internal coordinates with a ${kind}`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = createRootRoute();

          const routes = ["/app", "/other"].map((path) =>
            createRoute({ getParentRoute: () => root, path })
          );

          let inputCalls = 0;

          const options: Pick<AnyRouter["options"], "basepath" | "rewrite"> =
            kind === "basepath"
              ? { basepath: "/app" }
              : {
                  rewrite: {
                    input: ({ url }) => {
                      inputCalls += 1;
                      url.pathname = url.pathname.slice(4) || "/";

                      return url;
                    },
                    output: ({ url }) => {
                      url.pathname = `/app${url.pathname}`;

                      return url;
                    },
                  },
                };

          const router = createRouter({
            routeTree: root.addChildren(routes),
            history: createMemoryHistory({
              initialEntries: ["/app/app?q=1#anchor"],
            }),
            origin: "http://localhost",
            defaultPendingMs: Infinity,
            defaultPendingMinMs: 0,
            isServer: false,
            ...options,
          });

          yield* Effect.promise(async () => {
            await router.load();
          });
          assert.strictEqual(router.state.location.pathname, "/app");
          assert.strictEqual(router.state.location.href, "/app?q=1#anchor");
          assert.strictEqual(
            router.state.location.publicHref,
            "/app/app?q=1#anchor"
          );
          const callsBefore = inputCalls;

          const binding = tanstackSections(router, [
            {
              id: "app",
              title: "App",
              route: "/app",
              icon: { ios: "house", android: "app.svg" },
            },
            {
              id: "other",
              title: "Other",
              route: "/other",
              icon: { ios: "tray", android: "other.svg" },
            },
          ]);

          yield* Effect.acquireRelease(
            binding.mount.pipe(
              Effect.provide(bridgeTestLayer("browser", () => Effect.void))
            ),
            (remove) => Effect.sync(remove)
          );
          assert.strictEqual(inputCalls, callsBefore);
          assert.strictEqual(binding.controller.snapshot().active?.id, "app");
          yield* binding.controller.update({
            href: "/unowned",
            pathname: "/unowned",
          });
          assert.isNull(binding.controller.snapshot().active);
          assert.isTrue(binding.controller.snapshot().hidden);
          assert.isFalse(crossesSections(router, "/unowned", "/other"));
          assert.isTrue(crossesSections(router, "/app", "/other"));
          yield* navigate(router, "/other");
          assert.strictEqual(binding.controller.snapshot().active?.id, "other");

          const select = () =>
            Effect.promise(async () => {
              const pending = Effect.runPromise(
                binding.controller.select("app")
              );

              void router.load();
              await pending;
            });

          yield* select();
          assert.strictEqual(router.state.location.href, "/app?q=1#anchor");
          assert.strictEqual(
            router.state.location.publicHref,
            "/app/app?q=1#anchor"
          );
          yield* select();
          assert.strictEqual(router.state.location.href, "/app");
          assert.strictEqual(router.state.location.publicHref, "/app/app");
          assert.strictEqual(
            binding.controller.snapshot().active?.route,
            "/app"
          );
        })
      )
  );
}

it.effect(
  "keeps descendant ownership when the router adds trailing slashes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = createRootRoute();

        const router = createRouter({
          routeTree: root.addChildren(
            ["/café", "/café/item", "/other"].map((path) =>
              createRoute({ getParentRoute: () => root, path })
            )
          ),
          history: createMemoryHistory({
            initialEntries: ["/caf%C3%A9/item/"],
          }),
          origin: "http://localhost",
          defaultPendingMs: Infinity,
          defaultPendingMinMs: 0,
          isServer: false,
          trailingSlash: "always",
        });

        yield* Effect.promise(async () => {
          await router.load();
        });
        assert.strictEqual(router.state.location.pathname, "/café/item/");

        const binding = tanstackSections(router, [
          {
            id: "cafe",
            title: "Cafe",
            route: "/caf%C3%A9",
            icon: { ios: "house", android: "cafe.svg" },
          },
          {
            id: "other",
            title: "Other",
            route: "/other",
            icon: { ios: "tray", android: "other.svg" },
          },
        ]);

        yield* Effect.acquireRelease(
          binding.mount.pipe(
            Effect.provide(bridgeTestLayer("browser", () => Effect.void))
          ),
          (remove) => Effect.sync(remove)
        );
        assert.strictEqual(binding.controller.snapshot().active?.id, "cafe");
        assert.isTrue(crossesSections(router, "/café/item/", "/other/"));
        yield* Effect.promise(async () => {
          const pending = Effect.runPromise(binding.controller.select("cafe"));
          void router.load();
          await pending;
        });
        assert.strictEqual(router.state.location.pathname, "/café/");
        assert.strictEqual(
          binding.controller.snapshot().active?.route,
          "/caf%C3%A9"
        );
      })
    )
);
