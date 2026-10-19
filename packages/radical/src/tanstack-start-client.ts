import type { AnyRouter } from "@tanstack/react-router";
import { Effect, Layer } from "effect";

import { AdapterUnavailable } from "./adapter-error.ts";
import { RadicalAdapter } from "./adapter.ts";
import { tanstackNavigation } from "./tanstack-navigation.ts";

export type { RadicalRouteOptions } from "./tanstack-route-data.ts";

export { browserTransitions } from "./tanstack-navigation.ts";
export type { BrowserTransitionOptions } from "./tanstack-navigation.ts";
export { NavigationFailed } from "./navigation-error.ts";

/** Client navigation layer. Use TanStackStartAdapter for server request context. */
export const tanstackStartAdapterLayer = (router: AnyRouter) =>
  Layer.suspend(() =>
    Layer.succeed(RadicalAdapter, {
      name: "tanstack-start",
      routes: Effect.succeed([]),
      provideRequestContext: () =>
        Effect.fail(
          new AdapterUnavailable({ operation: "provideRequestContext" })
        ),
      navigation: Effect.succeed(tanstackNavigation(router)),
      outputs: Effect.succeed({ clientDir: "dist/client" }),
    })
  );
