import { Effect } from "effect";
import type { Layer } from "effect";
import type { Plugin } from "vite";

import type { RadicalAdapter } from "../core/adapter/adapter.ts";
import type { RadicalConfig } from "./config.ts";
import { nativePlugins } from "./plugins/plugin-virtual.ts";

export { InvalidPlugin } from "./plugins/errors.ts";

export { PluginDependencyConflict } from "./plugins/errors.ts";

export { AdapterUnavailable } from "../core/adapter/errors.ts";

export { RadicalAdapter } from "../core/adapter/adapter.ts";

export type {
  AdapterOutputs,
  RadicalCore,
  RadicalNavigation,
  RadicalRoute,
} from "../core/adapter/adapter.ts";

export {
  InvalidConfig,
  RadicalConfigSchema,
  validateConfig,
} from "./config.ts";

export type { RadicalConfig } from "./config.ts";

/** Validate at Vite's config hook, before either dev or build starts. */
export const radical = (
  config: RadicalConfig,
  adapterLayer?: Layer.Layer<RadicalAdapter>
): Plugin => ({
  ...nativePlugins(config, adapterLayer),
  name: "radical:config",
  configureServer: (server) =>
    Effect.runPromise(
      Effect.promise(() => import("./dev-server.ts")).pipe(
        Effect.tap(({ configureServer }) =>
          Effect.sync(() => {
            configureServer(config, server);
          })
        ),
        Effect.asVoid
      )
    ),
});
