import type { AnyRouter } from "@tanstack/react-router";
import { Effect, Layer } from "effect";

import { RadicalAdapter } from "../../core/adapter/adapter.ts";
import { AdapterUnavailable } from "../../core/adapter/errors.ts";
import { tanstackNavigation } from "./tanstack-navigation.ts";
import { tanstackOutputs } from "./tanstack-outputs.ts";

export type { RadicalRouteOptions } from "./tanstack-route-data.ts";

export { browserTransitions } from "./tanstack-navigation.ts";

export type { BrowserTransitionOptions } from "./tanstack-navigation.ts";

export { NavigationFailed } from "../../core/adapter/errors.ts";

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
      outputs: tanstackOutputs,
    })
  );
