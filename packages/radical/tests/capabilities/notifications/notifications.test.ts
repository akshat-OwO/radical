import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  PluginModules,
  resolvePlugins,
} from "../../../src/build/plugins/plugin-plan.ts";
import {
  browserNotificationsLayer,
  cancelNotification,
  checkNotificationPermission,
  clearNotificationBadge,
  getNotificationTopics,
  isSubscribedToTopic,
  registerPush,
  requestNotificationPermission,
  scheduleNotification,
  setNotificationBadge,
  subscribeToTopic,
  unsubscribeFromTopic,
} from "../../../src/capabilities/notifications/notifications.ts";
import type {
  LocalNotification,
  BrowserNotifications,
} from "../../../src/capabilities/notifications/notifications.ts";
import type { Bridge } from "../../../src/core/bridge/bridge.ts";
import { bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";

const reminder: LocalNotification = {
  id: 22,
  title: "Reminder",
  delaySeconds: 5,
  route: "/offline-route?from=notification",
};
const unusedBrowser = browserNotificationsLayer(() => {});

for (const runtime of ["android", "ios"] as const) {
  it.effect(
    `schedules and cancels ${runtime} notifications using the Effect clock`,
    () =>
      Effect.gen(function* () {
        const calls: unknown[] = [];
        const layer = Layer.merge(
          unusedBrowser,
          bridgeTestLayer(runtime, (plugin, method, args) =>
            Effect.sync(() => {
              calls.push([plugin, method, args]);
              return method === "checkPermissions"
                ? { display: "granted" }
                : undefined;
            })
          )
        );
        yield* TestClock.setTime(1000);
        yield* scheduleNotification(reminder).pipe(Effect.provide(layer));
        yield* cancelNotification(22).pipe(Effect.provide(layer));
        assert.deepStrictEqual(calls, [
          ["LocalNotifications", "checkPermissions", {}],
          [
            "LocalNotifications",
            "schedule",
            {
              notifications: [
                {
                  id: 22,
                  title: "Reminder",
                  body: undefined,
                  schedule: { at: "1970-01-01T00:00:06.000Z" },
                  extra: { route: reminder.route },
                },
              ],
            },
          ],
          ["LocalNotifications", "cancel", { notifications: [{ id: 22 }] }],
        ]);
      })
  );
}

it.effect(
  "delivers browser reminders after their delay and cancels or replaces by id",
  () =>
    Effect.gen(function* () {
      const delivered: string[] = [];
      const layer = Layer.merge(
        browserNotificationsLayer(() => ({
          permission: "granted",
          request: async () =>
            await Effect.runPromise(Effect.succeed("granted" as const)),
          show: (value) => {
            delivered.push(value.title);
          },
        })),
        bridgeTestLayer("browser", () => Effect.die("Unexpected native call"))
      );
      yield* Effect.gen(function* () {
        yield* scheduleNotification(reminder);
        yield* TestClock.adjust("4 seconds");
        assert.deepStrictEqual(delivered, []);
        yield* scheduleNotification({ ...reminder, title: "Replacement" });
        yield* TestClock.adjust("1 second");
        assert.deepStrictEqual(delivered, []);
        yield* TestClock.adjust("4 seconds");
        assert.deepStrictEqual(delivered, ["Replacement"]);
        yield* scheduleNotification(reminder);
        yield* cancelNotification(22);
        yield* TestClock.adjust("10 seconds");
        assert.deepStrictEqual(delivered, ["Replacement"]);
      }).pipe(Effect.provide(layer));
    })
);

it.effect(
  "reports browser permission without calling native and requests it explicitly",
  () =>
    Effect.gen(function* () {
      let requests = 0;
      const layer = Layer.merge(
        browserNotificationsLayer(() => ({
          permission: "prompt",
          request: async () => {
            requests += 1;
            return await Effect.runPromise(Effect.succeed("granted" as const));
          },
          show: () => {},
        })),
        bridgeTestLayer("browser", () => Effect.die("Unexpected native call"))
      );
      assert.strictEqual(
        yield* checkNotificationPermission.pipe(Effect.provide(layer)),
        "prompt"
      );
      assert.strictEqual(requests, 0);
      assert.strictEqual(
        yield* requestNotificationPermission.pipe(Effect.provide(layer)),
        "granted"
      );
      assert.strictEqual(requests, 1);
      assert.strictEqual(
        (yield* scheduleNotification(reminder).pipe(
          Effect.provide(layer),
          Effect.flip
        ))._tag,
        "PermissionDenied"
      );
    })
);

it.effect("reports missing browser APIs and unsupported badges and push", () =>
  Effect.gen(function* () {
    const layer = Layer.merge(
      unusedBrowser,
      bridgeTestLayer("browser", () => Effect.die("Unexpected native call"))
    );
    const operations: readonly Effect.Effect<
      unknown,
      { readonly _tag: string },
      Bridge | BrowserNotifications
    >[] = [
      checkNotificationPermission,
      requestNotificationPermission,
      scheduleNotification(reminder),
      registerPush,
      setNotificationBadge(1),
    ];
    for (const operation of operations) {
      assert.strictEqual(
        (yield* operation.pipe(Effect.provide(layer), Effect.flip))._tag,
        "Unavailable"
      );
    }
  })
);

it.effect("rejects invalid inputs before calling native plugins", () =>
  Effect.gen(function* () {
    const layer = Layer.merge(
      unusedBrowser,
      bridgeTestLayer("android", () =>
        Effect.die("Invalid input reached native")
      )
    );
    const operations: readonly Effect.Effect<
      unknown,
      { readonly _tag: string },
      Bridge | BrowserNotifications
    >[] = [
      scheduleNotification({ ...reminder, id: -1 }),
      scheduleNotification({ ...reminder, delaySeconds: 0 }),
      scheduleNotification({ ...reminder, route: "//evil.test" }),
      cancelNotification(0),
      setNotificationBadge(-1),
      subscribeToTopic("bad topic"),
      unsubscribeFromTopic(""),
    ];
    for (const operation of operations) {
      assert.strictEqual(
        (yield* operation.pipe(Effect.provide(layer), Effect.flip))._tag,
        "Unavailable"
      );
    }
  })
);

it.effect("returns a typed error when Firebase configuration is missing", () =>
  Effect.gen(function* () {
    const layer = Layer.merge(
      unusedBrowser,
      bridgeTestLayer("ios", (plugin, method) => {
        assert.strictEqual(plugin, "RadicalNotificationTopics");
        assert.strictEqual(method, "status");
        return Effect.succeed({ configured: false });
      })
    );
    const operations: readonly Effect.Effect<
      unknown,
      { readonly _tag: string },
      Bridge | BrowserNotifications
    >[] = [
      registerPush,
      subscribeToTopic("demo"),
      unsubscribeFromTopic("demo"),
      getNotificationTopics,
    ];
    for (const operation of operations) {
      assert.strictEqual(
        (yield* operation.pipe(Effect.provide(layer), Effect.flip))._tag,
        "MissingPushConfiguration"
      );
    }
  })
);

it.effect(
  "registers push, confirms topic membership, and updates native badges",
  () =>
    Effect.gen(function* () {
      const memberships = new Set<string>();
      let badge = 0;
      const layer = Layer.merge(
        unusedBrowser,
        bridgeTestLayer("android", (plugin, method, args) =>
          Effect.sync(() => {
            if (plugin === "LocalNotifications") {
              return { display: "granted" };
            }
            if (plugin === "FirebaseMessaging") {
              return { token: "fcm-token" };
            }
            if (plugin === "Badge") {
              if (method === "isSupported") {
                return { isSupported: true };
              }
              assert.isNumber(args.count);
              badge = Number(args.count);
              return {};
            }
            if (method === "status") {
              return { configured: true };
            }
            if (method === "list") {
              return { topics: [...memberships].toSorted() };
            }
            const topic = String(args.topic);
            if (method === "subscribe") {
              memberships.add(topic);
            } else {
              memberships.delete(topic);
            }
            return {};
          })
        )
      );
      yield* Effect.gen(function* () {
        assert.strictEqual(yield* registerPush, "fcm-token");
        yield* subscribeToTopic("demo");
        assert.deepStrictEqual(yield* getNotificationTopics, ["demo"]);
        assert.isTrue(yield* isSubscribedToTopic("demo"));
        yield* unsubscribeFromTopic("demo");
        assert.isFalse(yield* isSubscribedToTopic("demo"));
        yield* setNotificationBadge(3);
        assert.strictEqual(badge, 3);
        yield* clearNotificationBadge;
        assert.strictEqual(badge, 0);
      }).pipe(Effect.provide(layer));
    })
);

it.effect("denies native scheduling and push without permission", () =>
  Effect.gen(function* () {
    const layer = Layer.merge(
      unusedBrowser,
      bridgeTestLayer("ios", (_plugin, method) =>
        Effect.succeed(
          method === "status" ? { configured: true } : { display: "denied" }
        )
      )
    );
    const operations: readonly Effect.Effect<
      unknown,
      { readonly _tag: string },
      Bridge | BrowserNotifications
    >[] = [scheduleNotification(reminder), registerPush];
    for (const operation of operations) {
      assert.strictEqual(
        (yield* operation.pipe(Effect.provide(layer), Effect.flip))._tag,
        "PermissionDenied"
      );
    }
  })
);

it.effect(
  "selects notification plugins without dropping other opt-in capabilities",
  () =>
    Effect.gen(function* () {
      const modules = Layer.succeed(PluginModules, {
        load: () => Effect.die("Unexpected module load"),
      });
      const config = {
        appId: "dev.test.app",
        internalPlugins: { device: false, transitions: false },
      };
      assert.deepStrictEqual(
        yield* resolvePlugins(config).pipe(Effect.provide(modules)),
        []
      );
      const local = yield* resolvePlugins({
        ...config,
        internalPlugins: { ...config.internalPlugins, notifications: true },
      }).pipe(Effect.provide(modules));
      assert.deepStrictEqual(
        local.map((value) => value.selector),
        ["networkPlugin", "localNotificationsPlugin", "badgePlugin"]
      );
      const push = yield* resolvePlugins({
        ...config,
        internalPlugins: {
          ...config.internalPlugins,
          notifications: true,
          pushNotifications: true,
          network: true,
          haptics: true,
        },
      }).pipe(Effect.provide(modules));
      assert.deepStrictEqual(
        push.map((value) => value.manifest.id).toSorted(),
        [
          "badge",
          "firebaseMessaging",
          "haptics",
          "localNotifications",
          "network",
          "notificationTopics",
        ]
      );
    })
);

for (const runtime of ["android", "ios"] as const) {
  for (const initial of ["prompt", "prompt-with-rationale"] as const) {
    for (const response of [
      "granted",
      "denied",
      "prompt-with-rationale",
    ] as const) {
      it.effect(
        `${runtime} requests ${initial} notification permission and handles ${response}`,
        () =>
          Effect.gen(function* () {
            for (const operation of [
              scheduleNotification(reminder),
              registerPush,
            ]) {
              const calls: string[] = [];
              const layer = Layer.merge(
                unusedBrowser,
                bridgeTestLayer(runtime, (_plugin, method) =>
                  Effect.sync(() => {
                    calls.push(method);
                    switch (method) {
                      case "status": {
                        return { configured: true };
                      }
                      case "checkPermissions": {
                        return { display: initial };
                      }
                      case "requestPermissions": {
                        return { display: response };
                      }
                      case "getToken": {
                        return { token: "fcm-token" };
                      }
                      default: {
                        return {};
                      }
                    }
                  })
                )
              );
              const result = yield* operation.pipe(
                Effect.provide(layer),
                Effect.result
              );
              assert.deepStrictEqual(
                calls.filter((method) => method.includes("Permissions")),
                ["checkPermissions", "requestPermissions"]
              );
              if (response === "granted") {
                assert.strictEqual(result._tag, "Success");
                assert.isTrue(
                  calls.includes("schedule") || calls.includes("getToken")
                );
              } else {
                assert.strictEqual(result._tag, "Failure");
                if (result._tag === "Failure") {
                  assert.strictEqual(result.failure._tag, "PermissionDenied");
                }
                assert.isFalse(calls.includes("schedule"));
                assert.isFalse(calls.includes("getToken"));
              }
            }
          })
      );
    }
  }
}
