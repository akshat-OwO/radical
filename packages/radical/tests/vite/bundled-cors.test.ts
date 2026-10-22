/* oxlint-disable typescript/no-unsafe-type-assertion -- Config hooks do not consume the Vite plugin context. */
/* oxlint-disable promise/prefer-await-to-callbacks -- Vite exposes a synchronous CORS origin callback. */
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Predicate } from "effect";
import { defaultAllowedOrigins, mergeConfig } from "vite";
import type { CorsOrigin, UserConfig } from "vite";

import type { RadicalConfig } from "../../src/vite/config.ts";
import { PluginModules } from "../../src/vite/plugins/plugin-modules.ts";
import { nativePlugins } from "../../src/vite/plugins/plugin-virtual.ts";
import { metadataMemory } from "../fixtures/native-metadata.ts";
import { hookHandler } from "../fixtures/vite-hooks.ts";

const configure = (config: RadicalConfig, user: UserConfig = {}) =>
  Effect.gen(function* () {
    const services = Layer.merge(
      metadataMemory().layer,
      Layer.succeed(PluginModules, { load: () => Effect.succeed({}) })
    );

    const hook = nativePlugins(config, undefined, services).config;
    assert.isDefined(hook);
    const handler = hookHandler(hook);

    // SAFETY: The config hook does not use its Vite plugin context.
    const result = yield* Effect.promise(
      async () =>
        // SAFETY: The config hook never reads its Vite plugin context.
        await handler.call({} as ThisParameterType<typeof handler>, user, {
          command: "serve",
          mode: "production",
          isPreview: true,
        })
    );

    // SAFETY: Both inputs are UserConfig; merging preserves the Vite config contract.
    return mergeConfig(user, result ?? {}) as UserConfig;
  });

const customOrigin = () => {};

const bundled = {
  appId: "dev.test.app",
  mode: "bundled",
  origin: "https://api.example.com",
} as const;

it.effect("passes only exact bundled origins through Vite CORS", () =>
  Effect.gen(function* () {
    const config = yield* configure(bundled);
    const cors = config.server?.cors;
    assert.ok(Predicate.isObjectKeyword(cors));
    const { origin } = cors;
    assert.isFunction(origin);
    assert.ok(Predicate.isFunction(origin));

    for (const value of ["https://localhost", "capacitor://localhost"]) {
      const policies: CorsOrigin[] = [];
      origin(value, (error, policy) => {
        assert.isNull(error);
        policies.push(policy);
      });
      assert.deepStrictEqual(policies, [false]);
    }

    for (const value of [
      undefined,
      "http://localhost",
      "https://localhost:4173",
      "https://sub.localhost",
      "https://127.0.0.1",
      "https://example.com",
      "https://localhost.evil.com",
      "capacitor://localhost.evil.com",
    ]) {
      const policies: CorsOrigin[] = [];
      origin(value, (error, policy) => {
        assert.isNull(error);
        policies.push(policy);
      });
      assert.deepStrictEqual(policies, [defaultAllowedOrigins]);
    }

    // Vite inherits server.cors when preview.cors is absent.
    assert.isUndefined(config.preview?.cors);
  })
);

it.effect("preserves explicit preview and inherited server CORS settings", () =>
  Effect.gen(function* () {
    for (const cors of [
      false,
      true,
      {},
      { origin: "https://example.com" },
      { origin: customOrigin },
    ]) {
      const preview = yield* configure(bundled, { preview: { cors } });
      assert.deepStrictEqual(preview.preview?.cors, cors);
      const server = yield* configure(bundled, { server: { cors } });
      assert.deepStrictEqual(server.server?.cors, cors);
      assert.isUndefined(server.preview?.cors);
    }
  })
);

it.effect("keeps Vite CORS defaults in remote and omitted modes", () =>
  Effect.gen(function* () {
    for (const mode of [undefined, "remote"] as const) {
      const config = yield* configure({ appId: "dev.test.app", mode });
      assert.isUndefined(config.server?.cors);
      assert.isUndefined(config.preview?.cors);
    }
  })
);
