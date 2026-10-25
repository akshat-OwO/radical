import { assert, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Effect } from "effect";

import { installRouterCommitHook } from "../../../src/adapters/tanstack-start/tanstack-router-internals.ts";
import { crossesSections } from "../../../src/adapters/tanstack-start/tanstack-section-ownership.ts";
import { tanstackSections } from "../../../src/adapters/tanstack-start/tanstack-sections.ts";
import type { Bridge } from "../../../src/core/bridge/bridge.ts";
import { bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";

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

const navigate = (router: ReturnType<typeof makeRouter>, to: string) =>
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
