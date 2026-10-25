import { assert, describe, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Effect, Layer } from "effect";

import { installNativeTransitions } from "../../../src/adapters/tanstack-start/tanstack-native-transitions.ts";
import { tanstackSections } from "../../../src/adapters/tanstack-start/tanstack-sections.ts";
import type { Section } from "../../../src/capabilities/sections/sections.ts";
import { NativeTransitions } from "../../../src/capabilities/transitions/native-transitions.ts";
import type {
  BackRequest,
  BackState,
} from "../../../src/capabilities/transitions/native-transitions.ts";

const sections: readonly Section[] = [
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
];

const makeRouter = () => {
  const root = createRootRoute();
  const slide = { radical: { transition: "slide" as const } };

  const routes = ["/", "/details", "/about", "/about/team"].map((path) =>
    createRoute({ getParentRoute: () => root, path, staticData: slide })
  );

  return createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    origin: "http://localhost",
    defaultPendingMs: Infinity,
    defaultPendingMinMs: 0,
    isServer: false,
  });
};

type TestRouter = ReturnType<typeof makeRouter>;

const ignoreBack = (_request: BackRequest) => {
  // Replaced once the installer subscribes.
};

const shell = () => {
  const calls: string[] = [];
  const states: BackState[] = [];
  let receive = ignoreBack;

  const layer = Layer.succeed(NativeTransitions, {
    nextId: Effect.succeed("back"),
    cover: () => Effect.sync(() => calls.push("cover")),
    painted: Effect.sync(() => calls.push("painted")),
    reveal: (_id, transition, index) =>
      Effect.sync(() =>
        calls.push(`${transition.kind}:${transition.direction}:${index}`)
      ),
    remove: () => Effect.sync(() => calls.push("remove")),
    setBack: (state) => Effect.sync(() => states.push(state)),
    exit: Effect.sync(() => calls.push("exit")),
    settle: Effect.sync(() => calls.push("settle")),
    onBack: (listener) =>
      Effect.sync(() => {
        receive = listener;

        return () => {
          receive = ignoreBack;
        };
      }),
  });

  return {
    calls,
    states,
    layer,
    back: (interactive = false) => {
      receive({ interactive });
    },
  };
};

const load = (router: TestRouter) =>
  Effect.promise(async () => {
    await router.load();
  });

const navigate = (router: TestRouter, to: string) =>
  Effect.promise(async () => {
    const pending = router.navigate({ to });
    void router.load();
    await pending;
  });

/** Back runs asynchronously; let its navigation commit before asserting. */
const settle = (router: TestRouter) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 5; turn += 1) {
      yield* Effect.yieldNow;
    }

    yield* load(router);
  });

const latest = (states: readonly BackState[]) => states.at(-1);

describe("platform back", () => {
  it.effect("pops history inside a section with the reversed transition", () =>
    Effect.gen(function* () {
      const router = makeRouter();
      yield* load(router);
      const native = shell();

      const controller = installNativeTransitions(
        router,
        {},
        native.layer,
        null
      );

      tanstackSections(router, sections);

      assert.deepStrictEqual(latest(native.states), {
        handles: false,
        pop: false,
        index: 0,
      });

      yield* navigate(router, "/details");
      assert.deepStrictEqual(latest(native.states), {
        handles: true,
        pop: true,
        index: 1,
      });

      native.calls.length = 0;
      native.back();
      yield* settle(router);

      assert.strictEqual(router.state.location.pathname, "/");
      assert.deepStrictEqual(native.calls, [
        "cover",
        "painted",
        "slide:back:1",
        "remove",
      ]);
      controller.dispose();
    })
  );

  it.effect("selects the start section from another section's root", () =>
    Effect.gen(function* () {
      const router = makeRouter();
      yield* load(router);
      const native = shell();

      const controller = installNativeTransitions(
        router,
        {},
        native.layer,
        null
      );

      tanstackSections(router, sections);

      yield* navigate(router, "/about");
      assert.deepStrictEqual(latest(native.states), {
        handles: true,
        pop: false,
        index: 1,
      });

      native.back();
      yield* settle(router);

      // Selection replaces the entry, so the start root now exits.
      assert.strictEqual(router.state.location.pathname, "/");
      assert.strictEqual(router.state.location.state.__TSR_index, 1);
      assert.deepStrictEqual(latest(native.states), {
        handles: false,
        pop: false,
        index: 1,
      });

      native.calls.length = 0;
      native.back();
      yield* settle(router);
      assert.deepStrictEqual(native.calls, ["exit"]);
      controller.dispose();
    })
  );

  it.effect("returns to the section root when history left the section", () =>
    Effect.gen(function* () {
      const router = makeRouter();
      yield* load(router);
      const native = shell();

      const controller = installNativeTransitions(
        router,
        {},
        native.layer,
        null
      );

      tanstackSections(router, sections);

      yield* navigate(router, "/about/team");
      native.calls.length = 0;
      native.back();
      yield* settle(router);

      assert.strictEqual(router.state.location.pathname, "/about");
      assert.deepStrictEqual(native.calls.slice(-2), [
        "slide:back:1",
        "remove",
      ]);
      controller.dispose();
    })
  );

  it.effect("settles an interactive pop without a second animation", () =>
    Effect.gen(function* () {
      const router = makeRouter();
      yield* load(router);
      const native = shell();

      const controller = installNativeTransitions(
        router,
        {},
        native.layer,
        null
      );

      tanstackSections(router, sections);

      yield* navigate(router, "/details");
      native.calls.length = 0;
      native.back(true);
      yield* settle(router);

      assert.strictEqual(router.state.location.pathname, "/");
      assert.deepStrictEqual(native.calls, ["painted", "settle"]);
      controller.dispose();
    })
  );

  it.effect("settles an interactive swipe that no longer pops", () =>
    Effect.gen(function* () {
      const router = makeRouter();
      yield* load(router);
      const native = shell();

      const controller = installNativeTransitions(
        router,
        {},
        native.layer,
        null
      );

      tanstackSections(router, sections);

      native.back(true);
      yield* settle(router);

      assert.deepStrictEqual(native.calls, ["settle", "exit"]);
      controller.dispose();
    })
  );

  it.effect("follows router history only without sections", () =>
    Effect.gen(function* () {
      const router = makeRouter();
      yield* load(router);
      const native = shell();

      const controller = installNativeTransitions(
        router,
        {},
        native.layer,
        null
      );

      yield* navigate(router, "/about");
      assert.deepStrictEqual(latest(native.states), {
        handles: true,
        pop: true,
        index: 1,
      });

      native.back();
      yield* settle(router);
      assert.strictEqual(router.state.location.pathname, "/");
      assert.deepStrictEqual(latest(native.states), {
        handles: false,
        pop: false,
        index: 0,
      });
      controller.dispose();
    })
  );
});
