import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { RadicalAdapter } from "../src/adapter.ts";
import { radical, TanStackStartAdapter } from "../src/tanstack-start.ts";

const readAdapter = Effect.gen(function* () {
  const adapter = yield* RadicalAdapter;
  return {
    name: adapter.name,
    routes: yield* adapter.routes,
    outputs: yield* adapter.outputs,
  };
});

describe("TanStack Start adapter", () => {
  it.effect(
    "provides empty routes and Start's client output through its layer",
    () =>
      Effect.gen(function* () {
        const adapter = yield* readAdapter.pipe(
          Effect.provide(TanStackStartAdapter)
        );
        assert.deepStrictEqual(adapter, {
          name: "tanstack-start",
          routes: [],
          outputs: { clientDir: "dist/client" },
        });
      })
  );

  it.effect(
    "reports unavailable request context and navigation as typed errors",
    () =>
      Effect.gen(function* () {
        const adapter = yield* RadicalAdapter;
        const contextError = yield* Effect.flip(
          adapter.provideRequestContext(() => Effect.void)
        );
        assert.strictEqual(contextError._tag, "AdapterUnavailable");
        assert.strictEqual(contextError.operation, "provideRequestContext");
        const navigation = yield* adapter.navigation;
        const navigateError = yield* Effect.flip(navigation.navigate("/"));
        assert.strictEqual(navigateError.operation, "navigate");
        const beforeError = yield* Effect.flip(
          navigation.onBeforeNavigate(() => Effect.void)
        );
        assert.strictEqual(beforeError.operation, "onBeforeNavigate");
        const afterError = yield* Effect.flip(
          navigation.onAfterNavigate(() => {})
        );
        assert.strictEqual(afterError.operation, "onAfterNavigate");
      }).pipe(Effect.provide(TanStackStartAdapter))
  );

  it.effect("lets a core consumer use an in-memory adapter layer", () =>
    Effect.gen(function* () {
      const adapter = yield* RadicalAdapter;
      const memory = Layer.succeed(RadicalAdapter, {
        ...adapter,
        name: "memory",
        routes: Effect.succeed([{ pattern: "/example", offline: true }]),
        outputs: Effect.succeed({ clientDir: "memory/client" }),
      });
      assert.deepStrictEqual(yield* readAdapter.pipe(Effect.provide(memory)), {
        name: "memory",
        routes: [{ pattern: "/example", offline: true }],
        outputs: { clientDir: "memory/client" },
      });
    }).pipe(Effect.provide(TanStackStartAdapter))
  );

  it.effect("registers the core config plugin", () =>
    Effect.sync(() => {
      const plugins = radical({ appId: "dev.radical.example" });
      assert.lengthOf(plugins, 1);
      assert.propertyVal(plugins[0], "name", "radical:config");
    })
  );
});
