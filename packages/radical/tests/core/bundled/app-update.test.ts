import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import {
  radicalFetch,
  RadicalFetchEnvironment,
} from "../../../src/core/bundled/bundled-request.ts";
import { withBundledRequests } from "../../../src/core/bundled/bundled-server.ts";
import { RequestFailed } from "../../../src/core/bundled/request-error.ts";
import { browserContext } from "../../../src/core/context/browser-context.ts";
import type { ShellContext } from "../../../src/core/context/native-context.ts";
import {
  APP_UPDATE_HEADER,
  APP_UPDATE_PATH,
  AppUpdatePolicySchema,
  appStoreUrl,
  createAppUpdateStore,
  resolveAppUpdate,
} from "../../../src/core/update/app-update.ts";
import {
  fetchAppUpdate,
  receiveAppUpdate,
} from "../../../src/core/update/update-client.ts";
import { appUpdateResponse } from "../../../src/core/update/update-server.ts";
import { RadicalConfigSchema } from "../../../src/vite/config.ts";

const config = {
  appId: "dev.app.test",
  android: { packageId: "dev.android.test" },
  ios: { appStoreId: "1234567890" },
};

const options = { config, minimumBuild: { android: 10, ios: 20 } };

const context = (
  platform: "android" | "ios",
  appBuild?: number
): ShellContext => ({
  platform,
  shellVersion: "1.0",
  safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
  windowLayout: { widthClass: "compact", posture: "flat", hinge: null },
  appBuild,
});

const request = (
  platform: "android" | "ios",
  build: number | undefined,
  bundled: boolean,
  path = "/requested"
) =>
  new Request(`https://api.example${path}`, {
    headers: {
      accept: "text/html",
      ...(bundled
        ? {
            origin: "https://localhost",
            "x-radical-context": encodeURIComponent(
              JSON.stringify(context(platform, build))
            ),
          }
        : {
            cookie: `radical-context=${encodeURIComponent(JSON.stringify(context(platform, build)))}`,
          }),
    },
  });

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new RequestFailed({ cause }),
  });

describe("minimum build", () => {
  for (const platform of ["android", "ios"] as const) {
    for (const bundled of [false, true]) {
      it.effect(
        `${platform} ${bundled ? "bundled" : "remote"} blocks missing and older builds before handlers and accepts equal and newer builds`,
        () =>
          Effect.gen(function* () {
            let calls = 0;

            const handler = withBundledRequests(
              () => {
                calls += 1;

                return new Response("normal");
              },
              {},
              options
            );

            const minimum = options.minimumBuild[platform];

            for (const build of [
              undefined,
              minimum - 1,
              minimum,
              minimum + 1,
            ]) {
              const before = calls;

              const response = yield* attempt(
                async () => await handler(request(platform, build, bundled))
              );

              const required = build === undefined || build < minimum;
              const blockedStatus = bundled ? 426 : 307;
              assert.strictEqual(
                response.status,
                required ? blockedStatus : 200
              );
              assert.strictEqual(calls, before + (required ? 0 : 1));
              assert.strictEqual(
                response.headers.get("cache-control"),
                "no-store"
              );
              assert.include(response.headers.get("vary"), "x-radical-context");

              if (required && bundled) {
                assert.include(
                  response.headers.get("access-control-expose-headers"),
                  APP_UPDATE_HEADER
                );
                assert.deepStrictEqual(
                  yield* attempt(async () => await response.text()),
                  JSON.stringify({
                    status: "required",
                    storeUrl: appStoreUrl(config, platform),
                  })
                );
              } else if (required) {
                assert.strictEqual(response.headers.get("location"), "/update");
              }
            }
          })
      );
    }
  }

  it.effect(
    "never blocks browsers and leaves a platform without a minimum current",
    () =>
      Effect.gen(function* () {
        assert.strictEqual(
          resolveAppUpdate(context("android"), { ios: 1 }, config).status,
          "current"
        );
        assert.strictEqual(
          resolveAppUpdate(browserContext(), options.minimumBuild, config)
            .status,
          "current"
        );
        assert.isUndefined(
          yield* appUpdateResponse(
            new Request("https://api.example/"),
            options,
            false
          )
        );
      })
  );
  it.effect(
    "preserves browser caching and permits a custom remote renderer",
    () =>
      Effect.gen(function* () {
        const handler = withBundledRequests(
          () =>
            new Response("browser", {
              headers: { "cache-control": "public, max-age=60" },
            }),
          {},
          options
        );

        const browser = yield* attempt(
          async () => await handler(new Request("https://api.example/"))
        );

        assert.strictEqual(browser.status, 200);
        assert.strictEqual(
          browser.headers.get("cache-control"),
          "public, max-age=60"
        );
        assert.include(browser.headers.get("vary"), "Cookie");

        const rendered = yield* appUpdateResponse(
          request("ios", 1, false),
          {
            ...options,
            renderUpdate: (state) =>
              new Response(state.storeUrl, {
                headers: { "content-type": "text/html" },
              }),
          },
          false
        );

        assert.isDefined(rendered);
        assert.strictEqual(rendered.headers.get("x-radical-offline"), "0");
        assert.strictEqual(
          yield* attempt(async () => await rendered.text()),
          "https://apps.apple.com/app/id1234567890"
        );
      })
  );
  it.effect(
    "redirects remote documents to the update route while APIs and bundled requests to that path remain blocked",
    () =>
      Effect.gen(function* () {
        const routeOptions = { ...options, updatePath: "/update" };

        const redirected = yield* appUpdateResponse(
          request("ios", 1, false),
          routeOptions,
          false
        );

        assert.strictEqual(redirected?.status, 307);
        assert.strictEqual(redirected?.headers.get("location"), "/update");
        assert.isUndefined(
          yield* appUpdateResponse(
            request("ios", 1, false, "/update"),
            routeOptions,
            false
          )
        );
        assert.strictEqual(
          (yield* appUpdateResponse(
            request("ios", 1, true, "/update"),
            routeOptions,
            true
          ))?.status,
          426
        );
        const api = request("ios", 1, false, "/update");
        api.headers.set("accept", "application/json");
        assert.strictEqual(
          (yield* appUpdateResponse(api, routeOptions, false))?.status,
          426
        );
      })
  );
  it.effect(
    "keeps preflights and startup policy reachable for rejected binaries",
    () =>
      Effect.gen(function* () {
        const handler = withBundledRequests(
          () => assert.fail("policy called the app handler"),
          {},
          options
        );

        const preflight = new Request(request("android", 1, true), {
          method: "OPTIONS",
        });

        assert.strictEqual(
          (yield* attempt(async () => await handler(preflight))).status,
          204
        );
        const store = createAppUpdateStore();

        const state = yield* fetchAppUpdate(
          async () =>
            await handler(request("android", 1, true, APP_UPDATE_PATH)),
          store
        );

        assert.strictEqual(state.status, "required");
        assert.strictEqual(
          store.snapshot().storeUrl,
          appStoreUrl(config, "android")
        );
      })
  );
  it.effect(
    "validates platform minimums and numeric App Store ids and resolves native identities",
    () =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(RadicalConfigSchema)(config);

        for (const appStoreId of ["", "id123", "1.2", "-1", 123]) {
          assert.isFalse(
            Schema.is(RadicalConfigSchema)({ ...config, ios: { appStoreId } })
          );
        }

        for (const android of [
          0,
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
        ]) {
          assert.isFalse(Schema.is(AppUpdatePolicySchema)({ android }));
        }

        assert.strictEqual(
          appStoreUrl(config, "android"),
          "https://play.google.com/store/apps/details?id=dev.android.test"
        );
        assert.strictEqual(
          appStoreUrl(config, "ios"),
          "https://apps.apple.com/app/id1234567890"
        );
        assert.isNull(appStoreUrl({ appId: "dev.app.test" }, "ios"));
        assert.isNull(appStoreUrl(config, "browser"));
      })
  );
  it.effect(
    "moves the fetch store to required without consuming the 426 response and ignores unrelated origins",
    () =>
      Effect.gen(function* () {
        const store = createAppUpdateStore();

        const response = Response.json(
          { status: "required", storeUrl: appStoreUrl(config, "android") },
          { status: 426, headers: { [APP_UPDATE_HEADER]: "1" } }
        );

        const layer = Layer.succeed(RadicalFetchEnvironment, {
          page: Effect.succeed("https://localhost/home"),
          context: Effect.succeed(context("android", 1)),
          fetch: (input) =>
            Effect.sync(() => {
              assert.instanceOf(input, Request);

              return response;
            }),
        });

        const bundled = {
          mode: "bundled",
          origin: "https://api.example",
        } as const;

        yield* radicalFetch(
          bundled,
          "https://other.example/",
          undefined,
          store
        ).pipe(Effect.provide(layer));
        assert.strictEqual(store.snapshot().status, "unknown");

        const result = yield* radicalFetch(
          bundled,
          "/function",
          undefined,
          store
        ).pipe(Effect.provide(layer));

        assert.strictEqual(store.snapshot().status, "required");
        assert.strictEqual(result, response);
        assert.isFalse(result.bodyUsed);
        yield* receiveAppUpdate(
          Response.json(
            { status: "current", storeUrl: null },
            { headers: { [APP_UPDATE_HEADER]: "1" } }
          ),
          store
        );
        assert.strictEqual(store.snapshot().status, "required");
      })
  );
  it.effect(
    "leaves state unchanged for unmarked and malformed rejections and reports startup failures",
    () =>
      Effect.gen(function* () {
        const store = createAppUpdateStore();
        yield* receiveAppUpdate(
          new Response("unrelated", { status: 426 }),
          store
        );
        assert.strictEqual(store.snapshot().status, "unknown");

        const malformed = yield* Effect.flip(
          receiveAppUpdate(
            new Response("{", {
              status: 426,
              headers: { [APP_UPDATE_HEADER]: "1" },
            }),
            store
          )
        );

        assert.strictEqual(malformed._tag, "RequestFailed");
        assert.strictEqual(store.snapshot().status, "unknown");

        const failed = yield* Effect.flip(
          fetchAppUpdate(
            async () =>
              await Effect.runPromise(
                Effect.succeed(new Response(null, { status: 500 }))
              ),
            store
          )
        );

        assert.strictEqual(failed._tag, "RequestFailed");
      })
  );
});
