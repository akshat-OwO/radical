import type { AnyRouter } from "@tanstack/react-router";
import { Effect, Fiber, Layer } from "effect";

import type { BrowserTransitionOptions } from "../adapters/tanstack-start/tanstack-start-client.ts";
import {
  browserTransitions as installTransitions,
  tanstackStartAdapterLayer,
} from "../adapters/tanstack-start/tanstack-start-client.ts";
import {
  watchNotificationNavigation as watchNavigation,
  NotificationSnapshotsLive,
} from "../capabilities/notifications/notification-navigation.ts";
import {
  defaultRuntime,
  getEffectRuntime,
  runtimeBridgeLayer,
} from "./runtime.ts";
import type { RadicalRuntime } from "./runtime.ts";

export { NavigationFailed } from "../adapters/tanstack-start/tanstack-start-client.ts";

export type {
  BrowserTransitionOptions,
  RadicalRouteOptions,
} from "../adapters/tanstack-start/tanstack-start-client.ts";

/** Start notification navigation in the same bridge runtime as the provider. */

export const watchNotificationNavigation = (
  router: AnyRouter,
  options: {
    readonly appId: string;
    readonly push?: boolean;
    readonly onError?: (cause: unknown) => void;
  },
  runtime: RadicalRuntime = defaultRuntime
): (() => Promise<void>) => {
  const bridge = runtimeBridgeLayer(runtime);

  const fiber = getEffectRuntime(runtime).runFork(
    Effect.scoped(watchNavigation(options)).pipe(
      Effect.provide(
        Layer.merge(
          NotificationSnapshotsLive.pipe(Layer.provide(bridge)),
          tanstackStartAdapterLayer(router)
        )
      )
    )
  );

  return () => Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.asVoid));
};

export const browserTransitions = (
  router: Omit<AnyRouter, "history"> & {
    readonly history: AnyRouter["history"];
  },
  options?: BrowserTransitionOptions
) => installTransitions(router, options);
