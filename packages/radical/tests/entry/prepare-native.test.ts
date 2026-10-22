// oxlint-disable typescript/promise-function-async -- Fake Vite implements the Promise boundary owned by Effect.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  CliVite,
  makeCliViteLayer,
  prepareNative,
  readCliMetadata,
} from "../../src/entry/prepare-native.ts";
import { BuildPlanApi } from "../../src/vite/build-plan-api.ts";
import { resolveBuildPlan } from "../../src/vite/build-plan.ts";
import { PluginModules } from "../../src/vite/plugins/plugin-modules.ts";
import { metadataMemory } from "../fixtures/native-metadata.ts";

describe("CLI metadata read", () => {
  it.effect("reads the full bundled config and URL from the app root", () => {
    const config = {
      appId: "dev.example.app",
      mode: "bundled" as const,
      origin: "https://example.com",
    };

    const metadata = { config, url: "http://localhost:5173" };

    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* readCliMetadata("/app"), metadata);
    }).pipe(Effect.provide(metadataMemory(JSON.stringify(metadata)).layer));
  });
  it.effect("rejects config that the old partial CLI schema accepted", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(readCliMetadata("/app"));
      assert.strictEqual(error._tag, "InvalidConfig");
    }).pipe(
      Effect.provide(
        metadataMemory(JSON.stringify({ config: { mode: "bundled" } })).layer
      )
    )
  );
  it.effect("reports a missing metadata file", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        (yield* Effect.flip(readCliMetadata("/app")))._tag,
        "PlatformError"
      );
    }).pipe(Effect.provide(metadataMemory().layer))
  );
});

describe("CLI Vite root resolution", () => {
  for (const mode of ["remote", "bundled"] as const) {
    for (const configuredRoot of ["/workspace/client", undefined]) {
      it.effect(
        `uses ${configuredRoot ?? "cwd"} for ${mode} plans, builds and typegen`,
        () =>
          Effect.gen(function* () {
            const cwd = "/workspace";
            const expectedRoot = configuredRoot ?? cwd;
            const planRoots: string[] = [];
            const buildRoots: string[] = [];
            const resolutions: unknown[] = [];

            const plan = yield* resolveBuildPlan({
              appId: "dev.test.app",
              mode,
              origin: "https://example.test",
            }).pipe(
              Effect.provide(
                Layer.succeed(PluginModules, {
                  load: () => Effect.die("Unexpected plugin"),
                })
              )
            );

            const layer = makeCliViteLayer(
              Effect.succeed({
                resolveConfig: (inline, ...args) => {
                  resolutions.push([inline, ...args]);

                  return Promise.resolve({
                    root: inline.root ?? configuredRoot ?? cwd,
                    plugins: [
                      {
                        name: "radical:config",
                        api: new BuildPlanApi((root) =>
                          Effect.sync(() => {
                            planRoots.push(root);

                            return plan;
                          })
                        ),
                      },
                    ],
                  });
                },
                createBuilder: (inline) => {
                  assert.deepStrictEqual(inline, {});

                  return Promise.resolve({
                    buildApp: () => {
                      buildRoots.push(inline.root ?? configuredRoot ?? cwd);

                      return Promise.resolve();
                    },
                  });
                },
              })
            );

            yield* Effect.gen(function* () {
              assert.strictEqual(yield* prepareNative, plan);
              const vite = yield* CliVite;
              assert.strictEqual(
                (yield* vite.resolve(true)).root,
                expectedRoot
              );
            }).pipe(Effect.provide(layer));
            assert.deepStrictEqual(planRoots, [expectedRoot]);
            assert.deepStrictEqual(
              buildRoots,
              mode === "bundled" ? [expectedRoot] : []
            );
            assert.deepStrictEqual(resolutions, [
              [{}, "build", "production", "production"],
              [{}, "build"],
            ]);
          })
      );
    }
  }
});
