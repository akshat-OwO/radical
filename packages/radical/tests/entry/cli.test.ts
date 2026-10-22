import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Path, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";

import { CliNative, makeCli } from "../../src/entry/cli.ts";
import { CliVite } from "../../src/entry/prepare-native.ts";
import { AssetGenerator } from "../../src/native/assets/native-assets.ts";
import { BuildPlanApi } from "../../src/vite/build-plan-api.ts";
import { resolveBuildPlan } from "../../src/vite/build-plan.ts";
import { InvalidPlugin } from "../../src/vite/plugins/errors.ts";
import { PluginModules } from "../../src/vite/plugins/plugin-modules.ts";
import { metadataMemory } from "../fixtures/native-metadata.ts";

const fixture = (
  bundled = false,
  failure?: "resolve" | "build" | "generate",
  missingBuildPlan = false
) => {
  const calls: unknown[] = [];
  const record = (call: string | readonly (string | boolean)[]) =>
    Effect.sync(() => {
      calls.push(call);
    });
  const error = new InvalidPlugin({ message: "failed" });
  const memory = metadataMemory(
    JSON.stringify({
      config: {
        appId: "dev.test.app",
        mode: bundled ? "bundled" : "remote",
        origin: "https://example.test",
      },
      url: "https://example.test",
    })
  );
  const plan = resolveBuildPlan({
    appId: "dev.test.app",
    mode: bundled ? "bundled" : "remote",
    origin: "https://example.test",
  }).pipe(
    Effect.provide(
      Layer.succeed(PluginModules, {
        load: () => Effect.die("Unexpected plugin"),
      })
    )
  );
  const generate =
    (platform: string) =>
    (
      root: string,
      _packageRoot?: string,
      prepared?: Effect.Success<typeof plan>
    ) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(prepared, yield* plan);
        yield* record(["generate", platform, root]);
        return yield* failure === "generate"
          ? Effect.fail(error)
          : Effect.succeed(`/shell/${platform}`);
      });
  const run = (platform: string) => (project: string, target: string) =>
    record(["run", platform, project, target]).pipe(Effect.as(""));
  return {
    calls,
    error,
    layer: Layer.mergeAll(
      memory.layer,
      Path.layer,
      Stdio.layerTest({}),
      Layer.succeed(
        Terminal.Terminal,
        Terminal.make({
          columns: Effect.succeed(80),
          rows: Effect.succeed(24),
          readInput: Effect.die("Unexpected input"),
          readLine: Effect.die("Unexpected input"),
          display: () => Effect.void,
        })
      ),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.die("Unexpected process"))
      ),
      Layer.succeed(AssetGenerator, {
        generate: () => Effect.die("Unexpected assets"),
      }),
      Layer.succeed(PluginModules, {
        load: () => Effect.die("Unexpected plugin"),
      }),
      Layer.succeed(CliVite, {
        resolve: (typegen) =>
          record(["resolve", typegen]).pipe(
            Effect.andThen(
              failure === "resolve"
                ? Effect.fail(error)
                : Effect.succeed({
                    root: "/app",
                    plugins: missingBuildPlan
                      ? []
                      : [
                          {
                            name: "radical:config",
                            api: new BuildPlanApi(() => plan),
                          },
                        ],
                  })
            )
          ),
        build: record(["build"]).pipe(
          Effect.andThen(failure === "build" ? Effect.fail(error) : Effect.void)
        ),
      }),
      Layer.succeed(CliNative, {
        generateAndroid: generate("android"),
        generateIos: generate("ios"),
        runAndroid: run("android"),
        runIos: run("ios"),
      })
    ),
  };
};
const command = Command.runWith(makeCli("/app"), {
  version: "0.0.0",
  renderErrors: false,
});

describe("CLI orchestration", () => {
  for (const platform of ["android", "ios"]) {
    it.effect(
      `resolves, generates and runs ${platform} with the requested target`,
      () => {
        const fake = fixture();
        return Effect.gen(function* () {
          yield* command([platform, "--target", "device"]);
          assert.deepStrictEqual(fake.calls, [
            ["resolve", false],
            ["generate", platform, "/app"],
            ["run", platform, `/shell/${platform}`, "device"],
          ]);
        }).pipe(Effect.provide(fake.layer));
      }
    );
    it.effect(
      `generates ${platform} without launching for --generate-only`,
      () => {
        const fake = fixture();
        return Effect.gen(function* () {
          yield* command([platform, "--generate-only"]);
          assert.deepStrictEqual(fake.calls, [
            ["resolve", false],
            ["generate", platform, "/app"],
          ]);
        }).pipe(Effect.provide(fake.layer));
      }
    );
    it.effect(
      `builds the bundled UI before generating ${platform}, including --generate-only`,
      () => {
        const fake = fixture(true);
        return Effect.gen(function* () {
          yield* command([platform, "--generate-only"]);
          assert.deepStrictEqual(fake.calls, [
            ["resolve", false],
            ["build"],
            ["generate", platform, "/app"],
          ]);
        }).pipe(Effect.provide(fake.layer));
      }
    );
  }
  it.effect(
    "typegen resolves build config without reading metadata, building or generating shells",
    () => {
      const fake = fixture(true);
      return Effect.gen(function* () {
        yield* command(["typegen"]);
        assert.deepStrictEqual(fake.calls, [["resolve", true]]);
      }).pipe(Effect.provide(fake.layer));
    }
  );
  it.effect(
    "builds bundled UI before generation and launch with the default target",
    () => {
      const fake = fixture(true);
      return Effect.gen(function* () {
        yield* command(["android"]);
        assert.deepStrictEqual(fake.calls, [
          ["resolve", false],
          ["build"],
          ["generate", "android", "/app"],
          ["run", "android", "/shell/android", ""],
        ]);
      }).pipe(Effect.provide(fake.layer));
    }
  );
  it.effect(
    "stops before generation when the Vite build-plan API is absent",
    () => {
      const fake = fixture(false, undefined, true);
      return Effect.gen(function* () {
        assert.strictEqual(
          (yield* Effect.flip(command(["ios"])))._tag,
          "InvalidPlugin"
        );
        assert.deepStrictEqual(fake.calls, [["resolve", false]]);
      }).pipe(Effect.provide(fake.layer));
    }
  );
  for (const failure of ["resolve", "build", "generate"] as const) {
    it.effect(`stops orchestration after ${failure} fails`, () => {
      const fake = fixture(true, failure);
      return Effect.gen(function* () {
        assert.strictEqual(
          yield* Effect.flip(command(["android"])),
          fake.error
        );
        const expected = [
          ["resolve", false],
          ["build"],
          ["generate", "android", "/app"],
        ];
        assert.deepStrictEqual(
          fake.calls,
          expected.slice(0, { resolve: 1, build: 2, generate: 3 }[failure])
        );
      }).pipe(Effect.provide(fake.layer));
    });
  }
});
