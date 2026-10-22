import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { tanstackStartOptions } from "../../../src/adapters/tanstack-start/tanstack-start.ts";
import { RadicalAdapter } from "../../../src/core/adapter/adapter.ts";
import {
  bundledOrigins,
  localNativeContext,
  mountNativeContext,
  routeBundledRequest,
  RequestFailed,
} from "../../../src/core/bundled/bundled-request.ts";
import { withBundledRequests } from "../../../src/core/bundled/bundled-server.ts";
import { encodeNativeContextCookie } from "../../../src/core/context/native-context.ts";
import { getNativeContext } from "../../../src/entry/server.ts";
import { fakeAdapter } from "../../fixtures/adapter.ts";

const config = { mode: "bundled", origin: "https://api.example" } as const;

const context = {
  platform: "android",
  shellVersion: "1.0",
  safeArea: { top: 24, left: 0, right: 0, bottom: 16 },
} as const;

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new RequestFailed({ cause }),
  });

const contextRequest = (headers: Record<string, string>) =>
  new Request(config.origin, { headers });

describe("bundled requests", () => {
  it.effect(
    "keeps the bundled loader snapshot stable and applies injected insets only at mount",
    () =>
      Effect.gen(function* () {
        const styles = new Map<string, string>();

        const document = {
          __radicalNativeContext: context,
          __radicalMounted: false,
          document: {
            documentElement: {
              style: {
                setProperty: (name: string, value: string) => {
                  styles.set(name, value);
                },
              },
            },
          },
        };

        assert.strictEqual(
          (yield* localNativeContext(() => document)).platform,
          "browser"
        );
        assert.isEmpty(styles);
        assert.deepStrictEqual(
          yield* mountNativeContext(() => document),
          context
        );
        assert.isTrue(document.__radicalMounted);
        assert.strictEqual(styles.get("--radical-safe-area-top"), "24px");
        assert.strictEqual(styles.get("--radical-safe-area-bottom"), "16px");
        assert.deepStrictEqual(
          yield* localNativeContext(() => document),
          context
        );
      })
  );
  it.effect(
    "routes server functions and API paths from either shell with credentials and native context",
    () =>
      Effect.gen(function* () {
        for (const page of bundledOrigins) {
          for (const path of ["/_serverFn/id?payload=1", "/api/items"]) {
            const request = yield* routeBundledRequest(
              config,
              path,
              {
                method: "POST",
                body: "data",
                headers: {
                  "content-type": "text/plain",
                  "x-tsr-serverFn": "true",
                },
              },
              page,
              context
            );

            assert.strictEqual(request.url, config.origin + path);
            assert.strictEqual(request.credentials, "include");
            assert.strictEqual(request.method, "POST");
            assert.strictEqual(request.headers.get("x-tsr-serverFn"), "true");
            assert.strictEqual(
              yield* attempt(async () => await request.text()),
              "data"
            );
            assert.deepStrictEqual(yield* getNativeContext(request), context);
          }
        }
      })
  );
  it.effect(
    "resolves relative data URLs against the current document path",
    () =>
      Effect.gen(function* () {
        for (const page of bundledOrigins) {
          const result = yield* routeBundledRequest(
            config,
            "items?limit=2",
            undefined,
            `${page}/api/catalog/`,
            context
          );

          assert.strictEqual(
            result.url,
            "https://api.example/api/catalog/items?limit=2"
          );
        }
      })
  );
  it.effect("preserves a Request body and init overrides when routing", () =>
    Effect.gen(function* () {
      const source = new Request("https://localhost/api/items", {
        method: "POST",
        body: "original",
      });

      const result = yield* routeBundledRequest(
        config,
        source,
        { headers: { "x-test": "override" }, signal: source.signal },
        "https://localhost",
        context
      );

      assert.strictEqual(result.url, "https://api.example/api/items");
      assert.strictEqual(result.headers.get("x-test"), "override");
      assert.strictEqual(
        yield* attempt(async () => await result.text()),
        "original"
      );
    })
  );
  it.effect(
    "keeps remote mode and third-party requests unchanged without leaking native context",
    () =>
      Effect.gen(function* () {
        for (const scenario of [
          {
            config: { ...config, mode: "remote" } as const,
            input: "/_serverFn/id",
            page: "https://app.example",
            url: "https://app.example/_serverFn/id",
          },
          {
            config,
            input: "https://third.example/api",
            page: "https://localhost",
            url: "https://third.example/api",
          },
          {
            config,
            input: "/api",
            page: "https://browser.example",
            url: "https://browser.example/api",
          },
        ]) {
          const request = yield* routeBundledRequest(
            scenario.config,
            scenario.input,
            undefined,
            scenario.page,
            context
          );

          assert.strictEqual(request.url, scenario.url);
          assert.isNull(request.headers.get("x-radical-context"));
          assert.strictEqual(request.credentials, "same-origin");
        }
      })
  );
  it.effect(
    "prefers the context header, falls back to browser for malformed headers and retains remote cookies",
    () =>
      Effect.gen(function* () {
        const cookie = yield* encodeNativeContextCookie(context);
        assert.deepStrictEqual(
          yield* getNativeContext(
            contextRequest({ cookie: `radical-context=${cookie}` })
          ),
          context
        );
        assert.strictEqual(
          (yield* getNativeContext(
            contextRequest({
              "x-radical-context": "%invalid",
              cookie: `radical-context=${cookie}`,
            })
          )).platform,
          "browser"
        );
        assert.strictEqual(
          (yield* getNativeContext(
            contextRequest({
              "x-radical-context": encodeURIComponent(
                JSON.stringify({ ...context, platform: "ios" })
              ),
              cookie: `radical-context=${cookie}`,
            })
          )).platform,
          "ios"
        );
      })
  );
  it.effect("selects SPA output only for bundled mode", () =>
    Effect.sync(() => {
      assert.isTrue(
        tanstackStartOptions({ appId: "dev.app.test", ...config }).spa.enabled
      );
      assert.isFalse(
        tanstackStartOptions({ appId: "dev.app.test" }).spa.enabled
      );
    })
  );
});

describe("bundled API CORS", () => {
  it.effect("preserves exposed headers when the adapter declares none", () =>
    Effect.gen(function* () {
      for (const outputs of [{}, { exposedHeaders: [] }]) {
        const handler = withBundledRequests(
          () =>
            new Response(null, {
              headers: { "access-control-expose-headers": "x-existing" },
            }),
          outputs
        );

        const response = yield* attempt(
          async () =>
            await handler(
              new Request(config.origin, {
                headers: { origin: bundledOrigins[0] },
              })
            )
        );

        assert.strictEqual(
          response.headers.get("access-control-expose-headers"),
          "x-existing"
        );
      }
    })
  );
  it.effect(
    "answers credentialed preflights and exposes the fake adapter headers",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const adapter = yield* RadicalAdapter;
        const outputs = yield* adapter.outputs;

        const handler = withBundledRequests(() => {
          calls += 1;

          return new Response("ok", {
            headers: {
              "x-example-result": "true",
              "access-control-expose-headers": "x-existing",
              vary: "Accept-Encoding",
            },
          });
        }, outputs);

        for (const origin of bundledOrigins) {
          const preflight = yield* attempt(
            async () =>
              await handler(
                new Request(`${config.origin}/_serverFn/id`, {
                  method: "OPTIONS",
                  headers: {
                    origin,
                    "access-control-request-headers":
                      "x-tsr-serverFn,x-radical-context,content-type",
                  },
                })
              )
          );

          assert.strictEqual(preflight.status, 204);
          assert.strictEqual(calls, 0);
          assert.strictEqual(
            preflight.headers.get("access-control-allow-origin"),
            origin
          );
          assert.strictEqual(
            preflight.headers.get("access-control-allow-credentials"),
            "true"
          );
          assert.include(
            preflight.headers.get("access-control-allow-headers") ?? "",
            "x-radical-context"
          );
        }

        const response = yield* attempt(
          async () =>
            await handler(
              new Request(config.origin, {
                headers: { origin: bundledOrigins[0] },
              })
            )
        );

        assert.strictEqual(calls, 1);
        assert.strictEqual(
          response.headers.get("access-control-allow-origin"),
          bundledOrigins[0]
        );
        assert.strictEqual(
          response.headers.get("access-control-expose-headers"),
          "x-existing, x-example-result, x-example-error"
        );
        assert.strictEqual(
          response.headers.get("vary"),
          "Accept-Encoding, Origin"
        );
        assert.strictEqual(
          yield* attempt(async () => await response.text()),
          "ok"
        );
      }).pipe(Effect.provide(fakeAdapter))
  );
  it.effect(
    "retains response headers and varies CORS for denied, absent and same-origin requests",
    () =>
      Effect.gen(function* () {
        const source = new Response("remote", {
          headers: { vary: "Accept-Encoding" },
        });

        const adapter = yield* RadicalAdapter;

        const handler = withBundledRequests(
          () => source,
          yield* adapter.outputs
        );

        for (const origin of [
          "",
          config.origin,
          "https://attacker.example",
          "null",
          "https://localhost:444",
          "https://localhost.attacker.example",
        ]) {
          const response = yield* attempt(
            async () =>
              await handler(
                new Request(config.origin, {
                  headers: origin ? { origin } : {},
                })
              )
          );

          assert.strictEqual(response.status, source.status);
          assert.include(response.headers.get("vary") ?? "", "Accept-Encoding");
          assert.include(response.headers.get("vary") ?? "", "Origin");
          assert.isNull(response.headers.get("access-control-allow-origin"));
          assert.isNull(response.headers.get("access-control-expose-headers"));
        }
      }).pipe(Effect.provide(fakeAdapter))
  );
});
