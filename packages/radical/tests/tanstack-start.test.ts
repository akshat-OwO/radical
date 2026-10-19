import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { RadicalAdapter } from "../src/adapter.ts";
import { getNativeContext } from "../src/server.ts";
import {
  createRadicalMiddleware,
  radical,
  radicalRequestMiddleware,
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
  it.effect("rejects cross-site server functions while allowing SSR", () =>
    Effect.gen(function* () {
      const [csrf, nativeContext] = radicalRequestMiddleware;
      const guard = csrf.options.server;
      const provideContext = nativeContext.options.server;
      assert.isDefined(guard);
      assert.isDefined(provideContext);
      for (const scenario of [
        { handlerType: "serverFn", site: "cross-site", status: 403 },
        { handlerType: "serverFn", site: "same-origin", status: 200 },
        { handlerType: "router", site: "cross-site", status: 200 },
      ] as const) {
        const request = new Request("https://example.test/", {
          headers: {
            origin:
              scenario.site === "same-origin"
                ? "https://example.test"
                : "https://attacker.test",
            "sec-fetch-site": scenario.site,
          },
        });
        const expected = yield* getNativeContext(request);
        const options = {
          request,
          pathname: "/",
          context: undefined,
          handlerType: scenario.handlerType,
        };
        // Start composes heterogeneous middleware at runtime; its next() generic
        // cannot express the context added by a subsequent middleware.
        /* oxlint-disable typescript/no-unsafe-type-assertion -- Model Start's runtime middleware composition across context types. */
        const next = (async () =>
          await provideContext({
            ...options,
            next: ((provided) => {
              assert.deepStrictEqual<unknown>(provided?.context, {
                nativeContext: expected,
              });
              return {
                ...options,
                context: provided?.context,
                response: new Response("SSR or server function"),
              };
            }) as Parameters<typeof provideContext>[0]["next"],
          })) as Parameters<typeof guard>[0]["next"];
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        const result = yield* Effect.tryPromise({
          try: async () => await guard({ ...options, next }),
          catch: (cause) => new MiddlewareFailure({ cause }),
        });
        const response = result instanceof Response ? result : result.response;
        assert.strictEqual(response.status, scenario.status);
        assert.strictEqual(
          yield* Effect.tryPromise({
            try: async () => await response.text(),
            catch: (cause) => new MiddlewareFailure({ cause }),
          }),
          scenario.status === 403 ? "Forbidden" : "SSR or server function"
        );
      }
    })
  );

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
                    cookie: `radical-context=${encodeURIComponent(
                      JSON.stringify({
                        platform,
                        safeArea: { top: 12, right: 0, bottom: 4, left: 0 },
                        shellVersion: "2.0",
                      })
                    )}`,
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
      assert.strictEqual(navigateError._tag, "AdapterUnavailable");
      if (navigateError._tag === "AdapterUnavailable") {
        assert.strictEqual(navigateError.operation, "navigate");
      }
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
      assert.lengthOf(plugins, 2);
      assert.propertyVal(plugins[0], "name", "radical:config");
    })
  );
});
