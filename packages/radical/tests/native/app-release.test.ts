import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Layer } from "effect";

import { resolveAppRelease } from "../../src/native/shared/app-release.ts";

const memory = (env: Record<string, string> = {}) =>
  Layer.mergeAll(
    FileSystem.layerNoop({
      readFileString: () => Effect.succeed('{"version":"3.2.1"}'),
    }),
    ConfigProvider.layer(ConfigProvider.fromUnknown(env))
  );

it.effect(
  "resolves the app package version and config, flag, env build precedence",
  () =>
    Effect.gen(function* () {
      const config = { appId: "dev.test.app" };

      const layer = memory({ RADICAL_BUILD: "30" });

      assert.deepStrictEqual(
        yield* resolveAppRelease("/app", config, "ios").pipe(
          Effect.provide(layer)
        ),
        { version: "3.2.1", build: 30 }
      );

      assert.deepStrictEqual(
        yield* resolveAppRelease("/app", config, "ios", "20").pipe(
          Effect.provide(layer)
        ),
        { version: "3.2.1", build: 20 }
      );

      assert.deepStrictEqual(
        yield* resolveAppRelease(
          "/app",
          { ...config, version: "4.5.6", build: 10 },
          "ios",
          "invalid"
        ).pipe(Effect.provide(layer)),
        { version: "4.5.6", build: 10 }
      );
    })
);

it.effect(
  "rejects missing and invalid builds without inventing a counter",
  () =>
    Effect.gen(function* () {
      for (const build of [
        undefined,
        "",
        "0",
        "-1",
        "1.5",
        "1e3",
        " 1",
        "9007199254740992",
      ]) {
        const error = yield* Effect.flip(
          resolveAppRelease(
            "/app",
            { appId: "dev.test.app" },
            "android",
            build
          ).pipe(Effect.provide(memory()))
        );

        assert.strictEqual(error._tag, "InvalidConfig");

        assert.include(error.message, "build");
      }
    })
);

it.effect(
  "enforces Android's versionCode limit and iOS marketing version format",
  () =>
    Effect.gen(function* () {
      const config = { appId: "dev.test.app", build: 2_100_000_000 };

      assert.strictEqual(
        (yield* resolveAppRelease("/app", config, "android").pipe(
          Effect.provide(memory())
        )).build,
        2_100_000_000
      );

      const error = yield* Effect.flip(
        resolveAppRelease(
          "/app",
          { ...config, build: 2_100_000_001 },
          "android"
        ).pipe(Effect.provide(memory()))
      );

      assert.strictEqual(error._tag, "InvalidConfig");

      for (const version of ["1.0", "1.2.3-beta", "1.2.3\n", "a.b.c"]) {
        assert.strictEqual(
          (yield* Effect.flip(
            resolveAppRelease("/app", { ...config, version }, "ios").pipe(
              Effect.provide(memory())
            )
          ))._tag,
          "InvalidConfig"
        );
      }
    })
);
