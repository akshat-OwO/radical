import { Context, Effect, Layer } from "effect";
import type { InlineConfig, ResolvedConfig, resolveConfig } from "vite";

import {
  NativeMetadata,
  nativeMetadataLayer,
} from "../native/shared/native-metadata.ts";
import { BuildPlanApi } from "../vite/build-plan-api.ts";
import { InvalidPlugin } from "../vite/plugins/errors.ts";

export const readCliMetadata = (root: string) =>
  NativeMetadata.pipe(
    Effect.flatMap((metadata) => metadata.read(root)),
    Effect.provide(nativeMetadataLayer)
  );

/** Vite's process boundary, replaceable without loading app configuration in tests. */
export class CliVite extends Context.Service<
  CliVite,
  {
    readonly resolve: (
      typegen: boolean
    ) => Effect.Effect<Pick<ResolvedConfig, "root" | "plugins">, InvalidPlugin>;
    readonly build: Effect.Effect<void, InvalidPlugin>;
  }
>()("radical/CliVite") {}

const loadVite = Effect.tryPromise({
  try: () => import("vite"),
  catch: (cause) => new InvalidPlugin({ message: String(cause) }),
});
/** Both resolution and builds use Vite's cwd config lookup without overriding root. */
export const makeCliViteLayer = (
  vite: Effect.Effect<
    {
      readonly resolveConfig: (
        ...args: Parameters<typeof resolveConfig>
      ) => Promise<Pick<ResolvedConfig, "root" | "plugins">>;
      readonly createBuilder: (config: InlineConfig) => Promise<{
        readonly buildApp: () => Promise<void>;
      }>;
    },
    InvalidPlugin
  >
) =>
  Layer.succeed(CliVite, {
    resolve: (typegen) =>
      vite.pipe(
        Effect.flatMap((runtime) =>
          Effect.tryPromise({
            try: () =>
              typegen
                ? runtime.resolveConfig({}, "build")
                : runtime.resolveConfig(
                    {},
                    "build",
                    "production",
                    "production"
                  ),
            catch: (cause) =>
              new InvalidPlugin({
                message: `Cannot resolve Vite config: ${String(cause)}`,
              }),
          })
        )
      ),
    build: vite.pipe(
      Effect.flatMap((runtime) =>
        Effect.tryPromise({
          try: () => runtime.createBuilder({}),
          catch: (cause) => new InvalidPlugin({ message: String(cause) }),
        })
      ),
      Effect.flatMap((builder) =>
        Effect.tryPromise({
          try: () => builder.buildApp(),
          catch: (cause) =>
            new InvalidPlugin({
              message: `Cannot build bundled UI: ${String(cause)}`,
            }),
        })
      )
    ),
  });

export const cliViteLayer = makeCliViteLayer(loadVite);

export const prepareNative = Effect.gen(function* () {
  const vite = yield* CliVite;
  const resolved = yield* vite.resolve(false);
  const api: unknown = resolved.plugins.find(
    (plugin) => plugin.name === "radical:config"
  )?.api;
  if (!(api instanceof BuildPlanApi)) {
    return yield* new InvalidPlugin({
      message:
        "Vite config must enable radical before generating a native project",
    });
  }
  const plan = yield* api.resolve(resolved.root);
  if (plan.config.mode === "bundled") {
    yield* vite.build;
  }
  return plan;
});
