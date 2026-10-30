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
  "resolves the app package version and flag, env, config build precedence",
  () =>
    Effect.gen(function* () {
      const config = { appId: "dev.test.app", build: 10 };

      const layer = memory({ RADICAL_BUILD: "30" });

      assert.deepStrictEqual(
        yield* resolveAppRelease("/app", config, "ios", "20").pipe(
          Effect.provide(layer)
        ),
        { version: "3.2.1", build: 20 }
      );

      assert.deepStrictEqual(
        yield* resolveAppRelease("/app", config, "ios").pipe(
          Effect.provide(layer)
        ),
        { version: "3.2.1", build: 30 }
      );

      assert.deepStrictEqual(
        yield* resolveAppRelease(
          "/app",
          { ...config, version: "4.5.6" },
          "ios"
        ).pipe(Effect.provide(memory({ RADICAL_BUILD: "" }))),
        { version: "4.5.6", build: 10 }
      );
    })
);

it.effect("uses build 1 when no source sets a build", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(
      yield* resolveAppRelease(
        "/app",
        { appId: "dev.test.app" },
        "android"
      ).pipe(Effect.provide(memory())),
      { version: "3.2.1", build: 1 }
    );
  })
);

it.effect("rejects invalid builds", () =>
  Effect.gen(function* () {
    for (const build of [
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
          { appId: "dev.test.app", build: 5 },
          "android",
          build
        ).pipe(Effect.provide(memory()))
      );

      assert.strictEqual(error._tag, "InvalidConfig");

      assert.include(error.message, "build");
    }

    const error = yield* Effect.flip(
      resolveAppRelease("/app", { appId: "dev.test.app" }, "android").pipe(
        Effect.provide(memory({ RADICAL_BUILD: "abc" }))
      )
    );

    assert.strictEqual(error._tag, "InvalidConfig");
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

      for (const version of ["1", "1.0", "1.2.3"]) {
        assert.strictEqual(
          (yield* resolveAppRelease("/app", { ...config, version }, "ios").pipe(
            Effect.provide(memory())
          )).version,
          version
        );
      }

      for (const version of ["1.2.3.4", "1.2.3-beta", "1.2.3\n", "a.b.c"]) {
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
