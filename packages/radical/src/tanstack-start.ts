import { Effect, Layer } from "effect";
import type { PluginOption } from "vite";

import { AdapterUnavailable } from "./adapter-error.ts";
import { RadicalAdapter } from "./adapter.ts";
import type { RadicalConfig } from "./config.ts";
import { offlineBuild } from "./offline-build.ts";
import { createRadicalMiddleware } from "./tanstack-middleware.ts";
import { radical as corePlugin } from "./vite.ts";

export type { RadicalRouteOptions } from "./tanstack-route-data.ts";

const unavailable = (operation: string) =>
  Effect.fail(new AdapterUnavailable({ operation }));

export {
  createRadicalRequestMiddleware,
  createRadicalMiddleware,
  radicalMiddleware,
  radicalRequestMiddleware,
} from "./tanstack-middleware.ts";

/** Request context is wired; navigation remains unavailable. */
// oxlint-disable-next-line eslint/no-inline-comments -- Bundlers require the purity annotation immediately before the call.
export const TanStackStartAdapter = /* @__PURE__ */ Layer.suspend(() =>
  Layer.succeed(RadicalAdapter, {
    name: "tanstack-start",
    routes: Effect.succeed([]),
    provideRequestContext: (get) =>
      Effect.sync(() => createRadicalMiddleware(get)),
    navigation: Effect.succeed({
      navigate: () => unavailable("navigate"),
      onBeforeNavigate: () => unavailable("onBeforeNavigate"),
      onAfterNavigate: () => unavailable("onAfterNavigate"),
    }),
    outputs: Effect.succeed({ clientDir: "dist/client" }),
  })
);

/** Register next to tanstackStart(); the host framework still owns rendering. */
export const radical = (config: RadicalConfig): PluginOption[] => [
  corePlugin(config),
  ...(config.mode === "bundled" ? [] : [offlineBuild(config)]),
];

export { NavigationFailed } from "./navigation-error.ts";

export { browserTransitions } from "./tanstack-navigation.ts";
export type { BrowserTransitionOptions } from "./tanstack-navigation.ts";

export { tanstackStartAdapterLayer } from "./tanstack-start-client.ts";

/** Pass to tanstackStart() so the native loading mode also selects SPA output. */
export const tanstackStartOptions = (config: RadicalConfig) => ({
  spa: { enabled: config.mode === "bundled" },
});
