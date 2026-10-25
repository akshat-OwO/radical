import { Effect, Layer } from "effect";
import type { PluginOption } from "vite";

import { RadicalAdapter } from "../../core/adapter/adapter.ts";
import { AdapterUnavailable } from "../../core/adapter/errors.ts";
import type { RadicalConfig } from "../../vite/config.ts";
import { offlineBuild } from "../../vite/offline-build.ts";
import { radical as corePlugin } from "../../vite/vite.ts";
import { createRadicalMiddleware } from "./tanstack-middleware.ts";
import { tanstackOutputs } from "./tanstack-outputs.ts";

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
    outputs: tanstackOutputs,
  })
);

/** Register next to tanstackStart(); the host framework still owns rendering. */
export const radical = (config: RadicalConfig): PluginOption[] => [
  corePlugin(config, TanStackStartAdapter),
  ...(config.mode === "bundled"
    ? []
    : [offlineBuild(config, TanStackStartAdapter)]),
];

export { NavigationFailed } from "../../core/adapter/errors.ts";

export { browserTransitions } from "./tanstack-navigation.ts";

export type { BrowserTransitionOptions } from "./tanstack-navigation.ts";

export { tanstackStartAdapterLayer } from "./tanstack-start-client.ts";

/** Pass to tanstackStart() so the native loading mode also selects SPA output. */
export const tanstackStartOptions = (config: RadicalConfig) => ({
  spa: { enabled: config.mode === "bundled" },
});

export { TanStackSections, tanstackSections } from "./tanstack-sections.ts";
