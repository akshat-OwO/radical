import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";

import { Unavailable } from "../../../src/capabilities/camera/camera-schema.ts";
import { BrowserNetwork } from "../../../src/capabilities/network/browser-network.ts";
import {
  NotificationSnapshots,
  notificationSnapshotsLayer,
  notificationRoute,
  watchNotificationNavigation,
} from "../../../src/capabilities/notifications/notification-navigation.ts";
import { RadicalAdapter } from "../../../src/core/adapter/adapter.ts";
import {
  Bridge,
  BridgeUnavailable,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";

it.effect(
  "accepts local and push taps and rejects external routes and other actions",
  () =>
    Effect.gen(function* () {
      for (const field of ["extra", "data"]) {
        assert.deepStrictEqual(
          yield* notificationRoute({
            actionId: "tap",
            notification: { [field]: { route: "/offline-route?item=1" } },
          }),
          Option.some("/offline-route?item=1")
        );
      }

      for (const route of [
        "//evil.test",
        "https://evil.test",
        "/\\evil.test",
        "/bad\nroute",
        "missing-slash",
      ]) {
        assert.isTrue(
          Option.isNone(
            yield* notificationRoute({
              actionId: "tap",
              notification: { data: { route } },
            })
          )
        );
      }

      assert.isTrue(
        Option.isNone(
          yield* notificationRoute({
            actionId: "dismiss",
            notification: { extra: { route: "/" } },
          })
        )
      );
      assert.isTrue(Option.isNone(yield* notificationRoute({ invalid: true })));
    })
);

for (const runtime of ["browser", "android", "ios"] as const) {
  for (const restoration of ["snapshot", "missing", "failed"] as const) {
    it.effect(
      `${runtime} tap tries snapshot first, handles ${restoration}, and releases every listener`,
      () =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<boolean>();
          const finished = yield* Deferred.make<boolean>();

          const listeners = new Map<
            string,
            Parameters<Bridge["Service"]["observe"]>[1]
          >();

          const order: string[] = [];
          let removed = 0;

          const layer = Layer.mergeAll(
            Layer.succeed(Bridge, {
              runtime: Effect.succeed(runtime),
              call: () => Effect.die("Unexpected bridge command"),
              observe: (event, receive) =>
                Effect.gen(function* () {
                  listeners.set(event, receive);
                  yield* Deferred.succeed(ready, true);

                  return () => {
                    removed += 1;
                  };
                }),
              listen: (plugin, event, receive) =>
                Effect.gen(function* () {
                  listeners.set(`${plugin}:${event}`, receive);

                  if (listeners.size === 2) {
                    yield* Deferred.succeed(ready, true);
                  }

                  return Effect.sync(() => {
                    removed += 1;
                  });
                }),
            }),
            Layer.succeed(RadicalAdapter, {
              name: "memory",
              routes: Effect.succeed([]),
              outputs: Effect.succeed({ clientDir: "memory" }),
              provideRequestContext: () => Effect.void,
              navigation: Effect.succeed({
                navigate: (route: string) =>
                  Effect.gen(function* () {
                    order.push(`navigate:${route}`);
                    yield* Deferred.succeed(finished, true);
                  }),
                onBeforeNavigate: () => Effect.succeed(() => {}),
                onAfterNavigate: () => Effect.succeed(() => {}),
              }),
            }),
            Layer.succeed(NotificationSnapshots, {
              restore: (route, appId) =>
                Effect.gen(function* () {
                  assert.strictEqual(appId, "dev.test.app");
                  order.push(`snapshot:${route}`);

                  if (restoration === "failed") {
                    return yield* new Unavailable({
                      reason: "Cache unavailable",
                    });
                  }

                  if (restoration === "snapshot") {
                    yield* Deferred.succeed(finished, true);
                  }

                  return restoration === "snapshot";
                }),
            })
          );

          const fiber = yield* Effect.scoped(
            watchNotificationNavigation({ appId: "dev.test.app", push: true })
          ).pipe(Effect.provide(layer), Effect.forkChild);

          yield* Deferred.await(ready);

          const receive = listeners.get(
            runtime === "browser"
              ? "radical-notification"
              : "FirebaseMessaging:notificationActionPerformed"
          );

          assert.isDefined(receive);
          receive?.(
            runtime === "browser"
              ? { route: "/offline-route" }
              : {
                  actionId: "tap",
                  notification: { data: { route: "/offline-route" } },
                }
          );
          yield* Deferred.await(finished);
          yield* Fiber.interrupt(fiber);
          assert.deepStrictEqual(
            order,
            restoration === "snapshot"
              ? ["snapshot:/offline-route"]
              : ["snapshot:/offline-route", "navigate:/offline-route"]
          );
          assert.strictEqual(removed, runtime === "browser" ? 1 : 2);
        })
    );
  }
}

for (const runtime of ["browser", "android", "ios"] as const) {
  for (const connected of [false, true]) {
    it.effect(
      `selects live ${runtime} snapshots from connected=${connected}`,
      () =>
        Effect.gen(function* () {
          const calls: string[] = [];

          const status = {
            connected,
            connectionType: connected ? "wifi" : "none",
          } as const;

          const dependencies = Layer.merge(
            bridgeTestLayer(runtime, (plugin, method) => {
              assert.strictEqual(plugin, "Network");
              assert.strictEqual(method, "getStatus");

              return Effect.succeed(status);
            }),
            Layer.succeed(BrowserNetwork, {
              current:
                runtime === "browser"
                  ? Effect.succeed(status)
                  : Effect.die("Native must use Network"),
              listen: () => Effect.die("Unexpected subscription"),
            })
          );

          const layer = notificationSnapshotsLayer({
            restore: (route, appId) =>
              Effect.sync(() => {
                calls.push(`${appId}:${route}`);

                return true;
              }),
          }).pipe(Layer.provide(dependencies));

          const restored = yield* Effect.gen(function* () {
            const snapshots = yield* NotificationSnapshots;

            return yield* snapshots.restore(
              "/offline-route?item=1#x",
              "dev.test.app"
            );
          }).pipe(Effect.provide(layer));

          assert.strictEqual(restored, !connected);
          assert.deepStrictEqual(
            calls,
            connected ? [] : ["dev.test.app:/offline-route?item=1#x"]
          );
        })
    );
  }
}

for (const runtime of ["android", "ios"] as const) {
  for (const found of [false, true]) {
    it.effect(
      `live ${runtime} selection tries snapshots with unavailable status and match=${found}`,
      () =>
        Effect.gen(function* () {
          const calls: string[] = [];

          const dependencies = Layer.merge(
            bridgeTestLayer(runtime, (plugin, method) => {
              assert.strictEqual(plugin, "Network");
              assert.strictEqual(method, "getStatus");

              return Effect.fail(new BridgeUnavailable({ plugin, method }));
            }),
            Layer.succeed(BrowserNetwork, {
              current: Effect.die("Native must use Network"),
              listen: () => Effect.die("Unexpected subscription"),
            })
          );

          const layer = notificationSnapshotsLayer({
            restore: (route, appId) =>
              Effect.sync(() => {
                calls.push(`${appId}:${route}`);

                return found;
              }),
          }).pipe(Layer.provide(dependencies));

          const restored = yield* Effect.gen(function* () {
            const snapshots = yield* NotificationSnapshots;

            return yield* snapshots.restore(
              "/offline-route?item=1#x",
              "dev.test.app"
            );
          }).pipe(Effect.provide(layer));

          assert.strictEqual(restored, found);
          assert.deepStrictEqual(calls, [
            "dev.test.app:/offline-route?item=1#x",
          ]);
        })
    );
  }
}
