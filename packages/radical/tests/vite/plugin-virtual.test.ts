import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";

import { PluginModules } from "../../src/vite/plugins/plugin-modules.ts";
import { nativePlugins } from "../../src/vite/plugins/plugin-virtual.ts";
import { fakeAdapter, adapterOutputs } from "../fixtures/adapter.ts";
import { echo } from "../fixtures/echo-plugin.ts";
import { metadataMemory, metadataFile } from "../fixtures/native-metadata.ts";
import { resolvePlugin } from "../fixtures/vite-hooks.ts";

it.effect(
  "persists config, adapter outputs and declarations through configResolved while preserving identical declaration mtimes",
  () =>
    Effect.gen(function* () {
      const memory = metadataMemory(
        JSON.stringify({
          config: { appId: "dev.test.app" },
          url: "http://localhost:5173",
        })
      );

      const fs = yield* FileSystem.FileSystem.pipe(
        Effect.provide(memory.layer)
      );

      const writes: string[] = [];

      const services = Layer.merge(
        Layer.succeed(FileSystem.FileSystem, {
          ...fs,
          writeFileString: (file, value) =>
            fs.writeFileString(file, value).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  writes.push(file);
                })
              )
            ),
        }),
        Layer.succeed(PluginModules, { load: () => Effect.succeed({ echo }) })
      );

      const config = {
        appId: "dev.test.app",
        pluginOptions: { Echo: { prefix: "test" } },
        plugins: [{ manifest: "./plugins/echo.ts", selector: "echo" }],
      };

      const plugin = nativePlugins(config, fakeAdapter, services);
      yield* resolvePlugin(plugin);

      const metadata: unknown = JSON.parse(
        memory.files.get(metadataFile) ?? "null"
      );

      assert.deepStrictEqual(metadata, {
        config,
        url: "http://localhost:5173",
        outputs: adapterOutputs,
      });
      const file = "/app/.radical/plugins.d.ts";
      const declarations = memory.files.get(file) ?? "";
      assert.include(declarations, 'readonly "echo"');
      assert.include(declarations, "/app/plugins/echo.ts");
      assert.include(declarations, 'declare module "virtual:radical/config"');
      yield* resolvePlugin(plugin);
      assert.strictEqual(writes.filter((name) => name === file).length, 1);

      const changed = nativePlugins(
        { appId: "dev.test.app" },
        fakeAdapter,
        services
      );

      yield* resolvePlugin(changed);
      assert.strictEqual(writes.filter((name) => name === file).length, 2);
      assert.notInclude(memory.files.get(file) ?? "", 'readonly "echo"');
    })
);
