import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema, Predicate } from "effect";

import {
  createRadicalRequestMiddleware,
  createRadicalMiddleware,
  radical,
  radicalRequestMiddleware,
  TanStackStartAdapter,
} from "../../../src/adapters/tanstack-start/tanstack-start.ts";
import { RadicalAdapter } from "../../../src/core/adapter/adapter.ts";
import { getNativeContext } from "../../../src/entry/server.ts";

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
        // SAFETY: Each next continuation returns the context supplied by the middleware under test.
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
          outputs: {
            clientDir: "dist/client",
            spaShell: "_shell.html",
            exposedHeaders: ["x-tss-serialized", "x-tss-raw", "x-tss-error"],
          },
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

  it.effect(
    "defines Google sign-in options through the returned config hook",
    () =>
      Effect.gen(function* () {
        const googleSignIn = {
          webClientId: "web.apps.googleusercontent.com",
          iosClientId: "ios.apps.googleusercontent.com",
        };
        for (const enabled of [true, false, undefined]) {
          const [plugin] = radical({
            appId: "dev.radical.example",
            internalPlugins: { googleSignIn: enabled },
            pluginOptions: { GoogleSignIn: googleSignIn },
          });
          assert(
            plugin !== null &&
              Predicate.isObjectKeyword(plugin) &&
              "config" in plugin
          );
          const hook = plugin.config;
          assert.isDefined(hook);
          const handler = "handler" in hook ? hook.handler : hook;
          for (const host of [undefined, "localhost"]) {
            const resolved = yield* Effect.promise(
              async () =>
                await handler.call(
                  {
                    meta: {
                      viteVersion: "8.0.0",
                      rollupVersion: "4.0.0",
                      rolldownVersion: "1.0.0",
                    },
                    debug: () => {},
                    info: () => {},
                    warn: () => {},
                    error: () => assert.fail("Unexpected config error"),
                  },
                  { server: { host } },
                  { command: "build", mode: "production" }
                )
            );
            assert.strictEqual(
              resolved?.define?.__RADICAL_GOOGLE_SIGN_IN__,
              JSON.stringify(enabled === true ? googleSignIn : null)
            );
            assert.deepStrictEqual(resolved?.server, {
              host: host ?? "0.0.0.0",
              watch: { ignored: ["**/.radical/**"] },
            });
          }
        }
      })
  );

  it.effect("registers the core config plugin", () =>
    Effect.sync(() => {
      const plugins = radical({ appId: "dev.radical.example" });
      assert.lengthOf(plugins, 2);
      assert.propertyVal(plugins[0], "name", "radical:config");
    })
  );
});

describe("bundled server-function CSRF opt-in", () => {
  it.effect(
    "allows only exact bundled origins or same-origin fetch metadata",
    () =>
      Effect.gen(function* () {
        const [csrf] = createRadicalRequestMiddleware();
        const guard = csrf.options.server;
        assert.isDefined(guard);
        for (const origin of [
          "https://localhost",
          "capacitor://localhost",
          "https://attacker.test",
          "null",
          "https://localhost:444",
        ]) {
          for (const metadata of [true, false]) {
            const fetchSite: Record<string, string> = {};
            if (metadata) {
              fetchSite["sec-fetch-site"] = "cross-site";
            }
            const request = new Request("https://api.test/_serverFn/id", {
              headers: {
                origin,
                ...fetchSite,
              },
            });
            const options = {
              request,
              pathname: "/_serverFn/id",
              context: undefined,
              handlerType: "serverFn" as const,
            };
            // Start composes generic middleware contexts at runtime.
            // SAFETY: The fixture supplies every field read by the invoked API.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Model Start's continuation boundary.
            const next = (async () =>
              await Promise.resolve({
                ...options,
                response: new Response("allowed"),
              })) as Parameters<typeof guard>[0]["next"];
            const result = yield* Effect.tryPromise({
              try: async () =>
                await guard({
                  ...options,
                  next,
                }),
              catch: (cause) => new MiddlewareFailure({ cause }),
            });
            const response =
              result instanceof Response ? result : result.response;
            assert.strictEqual(
              response.status,
              origin === "https://localhost" ||
                origin === "capacitor://localhost"
                ? 200
                : 403
            );
          }
        }
      })
  );
});
