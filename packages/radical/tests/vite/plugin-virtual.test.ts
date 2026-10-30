import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";

import { PluginModules } from "../../src/vite/plugins/plugin-modules.ts";
import { nativePlugins } from "../../src/vite/plugins/plugin-virtual.ts";
import { fakeAdapter, adapterOutputs } from "../fixtures/adapter.ts";
import { echo } from "../fixtures/echo-plugin.ts";
import { metadataMemory, metadataFile } from "../fixtures/native-metadata.ts";
import { hookHandler, resolvePlugin } from "../fixtures/vite-hooks.ts";

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
        android: { packageId: "dev.test.android" },
        ios: { bundleId: "dev.test.ios", appStoreId: "123" },
        pluginOptions: { Echo: { prefix: "test" } },
        plugins: [{ manifest: "./plugins/echo.ts", selector: "echo" }],
      };

      const plugin = nativePlugins(config, fakeAdapter, services);
      yield* resolvePlugin(plugin);
      const { load } = plugin;
      assert.isDefined(load);
      const handler = hookHandler(load);

      const clientConfig = yield* Effect.promise(
        async () =>
          // SAFETY: The config loader uses no Vite context fields.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal Vite hook fixture.
          await handler.call(
            // SAFETY: The loader reads no fields from its Vite context.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal Vite hook fixture.
            {} as ThisParameterType<typeof handler>,
            "\0virtual:radical/config",
            {}
          )
      );

      assert.isString(clientConfig);
      assert.include(clientConfig, '"packageId":"dev.test.android"');
      assert.include(clientConfig, '"appStoreId":"123"');
      assert.notInclude(clientConfig, '"pluginOptions"');

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
