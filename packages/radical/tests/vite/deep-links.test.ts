import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
/* oxlint-disable vitest/no-standalone-expect -- Effect tests use it.effect. */
import { expect } from "vite-plus/test";

import { createRadicalRequestMiddleware } from "../../src/adapters/tanstack-start/tanstack-middleware.ts";
import { withBundledRequests } from "../../src/core/bundled/bundled-server.ts";
import {
  associationResponse,
  resolveDeepLinks,
} from "../../src/core/deep-links/deep-links.ts";
import { resolveBuildPlan } from "../../src/vite/build-plan.ts";
import { validateConfig } from "../../src/vite/config.ts";
import { PluginModules } from "../../src/vite/plugins/plugin-plan.ts";

const modules = Layer.succeed(PluginModules, {
  load: () => Effect.sync(() => assert.fail("Unexpected manifest load")),
});

const config = {
  appId: "dev.radical.app",
  origin: "https://example.com",
  ios: { bundleId: "dev.example.ios" },
  android: { packageId: "dev.example.android" },
  deepLinks: {
    ios: { teamId: "AB12345678" },
    android: {
      fingerprints: [Array.from({ length: 32 }, () => "AB").join(":")],
    },
    scheme: "myapp",
    exclude: ["/private/*", "/literal.json"],
  },
};

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: String });

describe("deep links", () => {
  it.effect(
    "validates credentials, schemes, path patterns and verified origins",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* validateConfig(config), config);

        for (const deepLinks of [
          { ios: { teamId: "short" } },
          { android: { fingerprints: [] } },
          { android: { fingerprints: ["AB:CD"] } },
          { scheme: "1app" },
          { scheme: "myapp://" },
          { exclude: ["relative/*"] },
          { exclude: ["/path?query"] },
        ]) {
          assert.strictEqual(
            (yield* Effect.flip(validateConfig({ ...config, deepLinks })))._tag,
            "InvalidConfig"
          );
        }

        for (const origin of [
          undefined,
          "http://example.com",
          "https://example.com:8443",
        ]) {
          assert.strictEqual(
            (yield* Effect.flip(validateConfig({ ...config, origin })))._tag,
            "InvalidConfig"
          );
        }

        yield* validateConfig({
          appId: config.appId,
          deepLinks: { scheme: "myapp+test" },
        });
        yield* validateConfig({
          ...config,
          origin: "https://example.com:443".replace(":443", ""),
        });
      })
  );

  it.effect(
    "resolves the build plan and filters paths independently of query and fragment",
    () =>
      Effect.gen(function* () {
        const { deepLinks } = yield* resolveBuildPlan(config).pipe(
          Effect.provide(modules)
        );

        assert.isTrue(deepLinks.ios);
        assert.isTrue(deepLinks.android);
        assert.strictEqual(deepLinks.scheme, "myapp");

        for (const path of [
          "/.radical/data",
          "/.well-known/file",
          "/_serverFn/id",
          "/_serverFn",
          "/api",
          "/api/items",
          "/private/a?x=1#hash",
          "/literal.json",
        ]) {
          assert.isFalse(deepLinks.filter.allows(path), path);
        }

        for (const path of [
          "/",
          "/settings?next=/api/items#fragment",
          "/apiary",
          "/literalXjson",
          "/private",
        ]) {
          assert.isTrue(deepLinks.filter.allows(path), path);
        }

        expect(deepLinks.apple).toMatchSnapshot("apple association");
        expect(deepLinks.assetlinks).toMatchSnapshot("android association");
      })
  );

  it.effect(
    "serves both association files before handlers in remote and bundled modes",
    () =>
      Effect.gen(function* () {
        for (const mode of ["remote", "bundled"] as const) {
          for (const deepLinks of [
            config.deepLinks,
            { ios: config.deepLinks.ios },
            { android: config.deepLinks.android },
            undefined,
          ]) {
            const selected = { ...config, mode, deepLinks };
            const plan = resolveDeepLinks(selected);

            const handler = withBundledRequests(
              () => new Response("unexpected", { status: 500 }),
              {},
              { config: selected }
            );

            for (const [file, enabled, body] of [
              [
                "apple-app-site-association",
                deepLinks?.ios !== undefined,
                plan.apple,
              ],
              [
                "assetlinks.json",
                deepLinks?.android !== undefined,
                plan.assetlinks,
              ],
            ] as const) {
              const request = new Request(
                `${config.origin}/.well-known/${file}?cache=1`
              );

              const direct = yield* associationResponse(request, plan);
              assert.strictEqual(direct?.status, enabled ? 200 : 404);

              const [, middleware] = createRadicalRequestMiddleware({
                config: selected,
                minimumBuild: { ios: 999 },
              });

              const { server } = middleware.options;

              assert.isDefined(server);

              const result = yield* attempt(
                async () =>
                  await server({
                    request,
                    pathname: new URL(request.url).pathname,
                    context: undefined,
                    handlerType: "router",
                    next: async () =>
                      await Effect.runPromise(
                        Effect.die("Association request reached router")
                      ),
                  })
              );

              assert.instanceOf(result, Response);
              assert.strictEqual(result.status, enabled ? 200 : 404);

              const response = yield* attempt(
                async () => await handler(request)
              );

              assert.strictEqual(response.status, enabled ? 200 : 404);
              assert.strictEqual(
                response.headers.get("content-type"),
                "application/json"
              );
              assert.isNull(response.headers.get("location"));
              assert.strictEqual(
                yield* attempt(async () => await response.text()),
                enabled ? JSON.stringify(body) : ""
              );
            }
          }
        }
      })
  );
});
