import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { RadicalAdapter } from "../src/adapter.ts";
import { getNativeContext } from "../src/server.ts";
import {
  createRadicalMiddleware,
  radical,
  TanStackStartAdapter,
} from "../src/tanstack-start.ts";

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is an Effect class factory.
class MiddlewareFailure extends Schema.TaggedError<
  MiddlewareFailure,
  { readonly brand: unique symbol }
>()("MiddlewareFailure", { cause: Schema.Unknown }) {}

const readAdapter = Effect.gen(function* () {
  const adapter = yield* RadicalAdapter;
  return {
    name: adapter.name,
    routes: yield* adapter.routes,
    outputs: yield* adapter.outputs,
  };
});

describe("TanStack Start adapter", () => {
  it.effect("creates request middleware through the adapter layer", () =>
    Effect.gen(function* () {
      const adapter = yield* RadicalAdapter;
      const middleware = yield* adapter.provideRequestContext(getNativeContext);
      assert.isObject(middleware);
      assert.containsAllKeys(middleware, ["options"]);
    }).pipe(Effect.provide(TanStackStartAdapter))
  );

  it.effect(
    "passes request context to next and preserves rejected responses",
    () =>
      Effect.gen(function* () {
        const middleware = createRadicalMiddleware();
        const { server } = middleware.options;
        assert.isDefined(server);
        for (const platform of ["ios", "android", "browser"]) {
          const request = new Request("https://example.test/", {
            headers:
              platform === "browser"
                ? {}
                : {
                    "x-radical-context": JSON.stringify({
                      platform,
                      safeArea: { top: 12, right: 0, bottom: 4, left: 0 },
                      shellVersion: "2.0",
                    }),
                  },
          });
          const expected = yield* getNativeContext(request);
          const completed = new Response(null, {
            status: 302,
            headers: { location: "/next" },
          });
          const result = yield* Effect.flip(
            Effect.tryPromise({
              try: async () =>
                await server({
                  request,
                  pathname: "/",
                  context: undefined,
                  handlerType: "router",
                  next: async (options) => {
                    assert.deepStrictEqual<unknown>(options?.context, {
                      nativeContext: expected,
                    });
                    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Start rejects redirects as Response objects.
                    return await Promise.reject(completed);
                  },
                }),
              catch: (cause) => new MiddlewareFailure({ cause }),
            })
          );
          assert.strictEqual(result.cause, completed);
        }
      })
  );
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

  it.effect("reports unavailable navigation as typed errors", () =>
    Effect.gen(function* () {
      const adapter = yield* RadicalAdapter;
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
