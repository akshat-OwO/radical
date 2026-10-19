import { Effect, Layer } from "effect";
import type { PluginOption } from "vite";

import { AdapterUnavailable } from "./adapter-error.ts";
import { RadicalAdapter } from "./adapter.ts";
import type { RadicalConfig } from "./config.ts";
import { radical as corePlugin } from "./vite.ts";

const unavailable = (operation: string) =>
  Effect.fail(new AdapterUnavailable({ operation }));

/** Native context and navigation are deliberately unavailable in the skeleton. */
export const TanStackStartAdapter = Layer.succeed(RadicalAdapter, {
  name: "tanstack-start",
  routes: Effect.succeed([]),
  provideRequestContext: () => unavailable("provideRequestContext"),
  navigation: Effect.succeed({
    navigate: () => unavailable("navigate"),
    onBeforeNavigate: () => unavailable("onBeforeNavigate"),
    onAfterNavigate: () => unavailable("onAfterNavigate"),
  }),
  outputs: Effect.succeed({ clientDir: "dist/client" }),
});

/** Register next to tanstackStart(); the host framework still owns rendering. */
export const radical = (config: RadicalConfig): PluginOption[] => [
  corePlugin(config),
];
