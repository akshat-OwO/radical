import { Context, Effect, Layer, Queue, Schema } from "effect";

import { RadicalAdapter } from "./adapter.ts";
import { Bridge } from "./bridge.ts";
import { Unavailable } from "./camera-schema.ts";
import { BrowserNetworkLive, getNetworkStatus } from "./network.ts";
import { NotificationRouteSchema } from "./notification-schema.ts";

/** Isolates Cache Storage and full-document navigation for deterministic tests. */
export class NotificationSnapshots extends Context.Service<
  NotificationSnapshots,
  {
    readonly restore: (
      route: string,
      appId: string
    ) => Effect.Effect<boolean, Unavailable>;
  }
>()("radical/NotificationSnapshots") {}
const snapshotStorage: NotificationSnapshots["Service"] = {
  restore: (route, appId) =>
    Effect.gen(function* () {
      if (!("caches" in globalThis)) {
        return false;
      }
      const found = yield* Effect.tryPromise({
        try: () => caches.keys(),
        catch: (cause) => new Unavailable({ reason: String(cause) }),
      }).pipe(
        Effect.flatMap((names) =>
          Effect.forEach(
            names.filter(
              (name) =>
                name.startsWith(`radical:${appId}:`) &&
                name.endsWith(":snapshots")
            ),
            (name) =>
              Effect.tryPromise({
                try: () => caches.open(name),
                catch: (cause) => new Unavailable({ reason: String(cause) }),
              }).pipe(
                Effect.flatMap((cache) =>
                  Effect.tryPromise({
                    try: () =>
                      cache.match(new URL(route, location.origin).href, {
                        ignoreVary: true,
                      }),
                    catch: (cause) =>
                      new Unavailable({ reason: String(cause) }),
                  })
                )
              )
          )
        ),
        Effect.map((matches) => matches.some(Boolean))
      );
      if (found) {
        window.location.assign(route);
      }
      return found;
    }),
};
/** Select snapshots using the platform network capability before reading storage. */
export const notificationSnapshotsLayer = (
  storage: NotificationSnapshots["Service"] = snapshotStorage
) =>
  Layer.effect(
    NotificationSnapshots,
    Effect.gen(function* () {
      const services =
        yield* Effect.context<Effect.Services<typeof getNetworkStatus>>();
      return {
        restore: (route: string, appId: string) =>
          getNetworkStatus.pipe(
            Effect.provide(services),
            Effect.matchEffect({
              onFailure: () => storage.restore(route, appId),
              onSuccess: (status) =>
                status.connected
                  ? Effect.succeed(false)
                  : storage.restore(route, appId),
            })
          ),
      };
    })
  );
export const NotificationSnapshotsLive = notificationSnapshotsLayer().pipe(
  Layer.provide(BrowserNetworkLive)
);
const actionSchema = Schema.Struct({
  actionId: Schema.String,
  notification: Schema.Struct({
    extra: Schema.optional(
      Schema.Struct({ route: Schema.optional(Schema.String) })
    ),
    data: Schema.optional(
      Schema.Struct({ route: Schema.optional(Schema.String) })
    ),
  }),
});
export const notificationRoute = (value: unknown) =>
  Effect.gen(function* () {
    const action = yield* Schema.decodeUnknownEffect(actionSchema)(value);
    if (action.actionId !== "tap") {
      return yield* new Unavailable({ reason: "Not a notification tap" });
    }
    return yield* Schema.decodeUnknownEffect(NotificationRouteSchema)(
      action.notification.extra?.route ?? action.notification.data?.route
    );
  }).pipe(Effect.option);
/** Own this watcher in an app/router scope, not in the notification example route. */
export const watchNotificationNavigation = (options: {
  readonly appId: string;
  readonly push?: boolean;
  readonly onError?: (error: unknown) => void;
}) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const adapter = yield* RadicalAdapter;
    const navigation = yield* adapter.navigation;
    const snapshots = yield* NotificationSnapshots;
    const queue = yield* Queue.unbounded<unknown>();
    const receive = (value: unknown) => {
      Queue.offerUnsafe(queue, value);
    };
    const runtime = yield* bridge.runtime;
    if (runtime === "browser") {
      const stop = yield* bridge.observe("radical-notification", (value) => {
        receive({ actionId: "tap", notification: { extra: value } });
      });
      yield* Effect.addFinalizer(() => Effect.sync(stop));
    } else {
      if (!bridge.listen) {
        return yield* new Unavailable({
          reason: "Notification events are unavailable",
        });
      }
      for (const [plugin, event] of [
        ["LocalNotifications", "localNotificationActionPerformed"],
        ...(options.push === true
          ? [["FirebaseMessaging", "notificationActionPerformed"]]
          : []),
      ]) {
        yield* Effect.acquireRelease(
          bridge.listen(plugin, event, receive),
          (stop) => stop
        ).pipe(Effect.asVoid);
      }
    }
    return yield* Effect.forever(
      Queue.take(queue).pipe(
        Effect.flatMap(notificationRoute),
        Effect.flatMap((route) =>
          route._tag === "Some"
            ? snapshots.restore(route.value, options.appId).pipe(
                Effect.orElseSucceed(() => false),
                Effect.flatMap((restored) =>
                  restored ? Effect.void : navigation.navigate(route.value)
                )
              )
            : Effect.void
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            options.onError?.(error);
          })
        ),
        Effect.ignore
      )
    );
  });
