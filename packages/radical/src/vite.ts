import { Effect } from "effect";
import type { Plugin } from "vite";

import type { RadicalConfig } from "./config.ts";
import { validateConfig } from "./config.ts";
import { nativePlugins } from "./plugin-virtual.ts";

export { InvalidPlugin } from "./invalid-plugin.ts";
export { PluginDependencyConflict } from "./plugin-dependency-conflict.ts";

export { AdapterUnavailable } from "./adapter-error.ts";
export { RadicalAdapter } from "./adapter.ts";
export type {
  RadicalCore,
  RadicalNavigation,
  RadicalRoute,
} from "./adapter.ts";
export {
  InvalidConfig,
  RadicalConfigSchema,
  validateConfig,
} from "./config.ts";

export type { RadicalConfig } from "./config.ts";

/** Validate at Vite's config hook, before either dev or build starts. */
export const radical = (config: RadicalConfig): Plugin => ({
  ...nativePlugins(config),
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
  // Shells reach the dev server over the LAN, unless the app chose its own host.
  config: (user) =>
    Effect.runPromise(
      validateConfig(config).pipe(
        Effect.as({
          server: {
            host: user.server?.host ?? "0.0.0.0",
            watch: { ignored: ["**/.radical/**"] },
          },
        })
      )
    ),
});
