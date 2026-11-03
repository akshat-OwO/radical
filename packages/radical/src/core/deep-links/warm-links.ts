import { Effect, Fiber, Layer, Queue, Schema } from "effect";

import { BrowserNetworkLive } from "../../capabilities/network/network.ts";
import {
  NotificationSnapshots,
  notificationSnapshotsLayer,
  snapshotStorageWithNavigation,
} from "../../capabilities/notifications/notification-navigation.ts";
import type { SnapshotStorage } from "../../capabilities/notifications/notification-navigation.ts";
import type { RadicalNavigation } from "../adapter/adapter.ts";
import { Bridge, BridgeLive } from "../bridge/bridge.ts";
import { Unavailable } from "../errors.ts";
import { DeepLinkPathFilter } from "./deep-links.ts";
import { openRoute } from "./open-route.ts";

declare global {
  interface Window {
    readonly __radicalDeepLinks?: {
      readonly appId: string;
      readonly excludes: readonly string[];
    };
  }
}

/** Register before acknowledging readiness to avoid losing a pending link. */
export const watchWarmLinks = (
  navigation: RadicalNavigation,
  config: {
    readonly appId: string;
    readonly excludes: readonly string[];
    readonly origin: string;
  }
) => {
  const filter = new DeepLinkPathFilter(config.excludes);

  return Effect.gen(function* () {
    const bridge = yield* Bridge;
    const snapshots = yield* NotificationSnapshots;
    const queue = yield* Queue.unbounded<unknown>();

    const stop = yield* bridge.observe("radicalDeepLink", (value) => {
      Queue.offerUnsafe(queue, value);
    });

    yield* Effect.addFinalizer(() => Effect.sync(stop));
    yield* bridge.call("RadicalSplash", "linksReady", {});

    return yield* Effect.forever(
      Queue.take(queue).pipe(
        Effect.flatMap((value) =>
          Schema.decodeUnknownEffect(Schema.String)(value).pipe(
            Effect.flatMap((url) =>
              Effect.try({
                try: () => new URL(url),
                catch: (cause) => new Unavailable({ reason: String(cause) }),
              })
            ),
            Effect.flatMap((url) =>
              url.origin === config.origin
                ? openRoute(url.pathname + url.search + url.hash, {
                    appId: config.appId,
                    allows: (path) => filter.allows(path),
                    restore: snapshots.restore,
                    navigation,
                  })
                : Effect.void
            ),
            Effect.ignore
          )
        )
      )
    );
  });
};

/** Use document navigation so the worker can serve saved HTML. */
export const warmLinkSnapshotsLayer = (
  documentNavigate: (route: string) => Effect.Effect<void, Unavailable> = (
    route
  ) =>
    Effect.sync(() => {
      window.location.assign(route);
    }),
  storage?: SnapshotStorage
) =>
  notificationSnapshotsLayer(
    snapshotStorageWithNavigation(documentNavigate, storage)
  );

/** Installed with the router's native navigation lifetime. */
export const installWarmLinks = (navigation: RadicalNavigation) => {
  const config =
    typeof window === "undefined" ? undefined : window.__radicalDeepLinks;

  if (!config) {
    return () => {
      /* No shell. */
    };
  }

  const fiber = Effect.runFork(
    Effect.scoped(
      watchWarmLinks(navigation, { ...config, origin: location.origin })
    ).pipe(
      Effect.provide(
        Layer.merge(
          BridgeLive,
          warmLinkSnapshotsLayer().pipe(
            Layer.provide(Layer.merge(BridgeLive, BrowserNetworkLive))
          )
        )
      )
    )
  );

  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
};
