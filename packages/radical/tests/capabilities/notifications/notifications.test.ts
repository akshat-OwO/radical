import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  checkExactAlarmPermission,
  requestExactAlarmPermission,
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
import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";
import {
  PluginModules,
  resolvePlugins,
} from "../../../src/vite/plugins/plugin-plan.ts";

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

              if (method === "checkPermissions") {
                return { display: "granted" };
              }

              return method === "schedule"
                ? { notifications: [{ id: 22 }] }
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
        assert.deepStrictEqual(yield* scheduleNotification(reminder), {
          notifications: [{ id: 22 }],
        });
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
            const operations: readonly Effect.Effect<
              unknown,
              { readonly _tag: string },
              Bridge | BrowserNotifications
            >[] = [scheduleNotification(reminder), registerPush];

            for (const operation of operations) {
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
                        return { notifications: [{ id: 22 }] };
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

for (const runtime of ["browser", "ios"] as const) {
  it.effect(
    `reports exact alarms as not-required on ${runtime} without native calls`,
    () =>
      Effect.gen(function* () {
        const layer = bridgeTestLayer(runtime, () =>
          Effect.die("Unexpected native call")
        );

        assert.strictEqual(
          yield* checkExactAlarmPermission.pipe(Effect.provide(layer)),
          "not-required"
        );
        assert.strictEqual(
          yield* requestExactAlarmPermission.pipe(Effect.provide(layer)),
          "not-required"
        );
      })
  );
}

for (const status of ["granted", "denied"] as const) {
  it.effect(
    `checks and requests Android exact alarms with ${status} consent`,
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];

        const layer = bridgeTestLayer("android", (plugin, method, args) =>
          Effect.sync(() => {
            assert.strictEqual(plugin, "LocalNotifications");
            assert.deepStrictEqual(args, {});
            calls.push(method);

            return { exact_alarm: status };
          })
        );

        assert.strictEqual(
          yield* checkExactAlarmPermission.pipe(Effect.provide(layer)),
          status
        );
        assert.strictEqual(
          yield* requestExactAlarmPermission.pipe(Effect.provide(layer)),
          status
        );
        assert.deepStrictEqual(calls, [
          "checkExactNotificationSetting",
          "changeExactNotificationSetting",
        ]);
      })
  );
}

it.effect(
  "rejects malformed exact-alarm settings with a typed decode error",
  () =>
    Effect.gen(function* () {
      for (const operation of [
        checkExactAlarmPermission,
        requestExactAlarmPermission,
      ]) {
        const error = yield* operation.pipe(
          Effect.provide(
            bridgeTestLayer("android", () =>
              Effect.succeed({ exact_alarm: "unknown" })
            )
          ),
          Effect.flip
        );

        assert.strictEqual(error._tag, "BridgeDecodeError");
      }
    })
);

it.effect("preserves native exact-alarm request failures", () =>
  Effect.gen(function* () {
    const failure = new BridgeCallFailed({
      plugin: "LocalNotifications",
      method: "changeExactNotificationSetting",
      cause: "Settings unavailable",
    });

    const error = yield* requestExactAlarmPermission.pipe(
      Effect.provide(bridgeTestLayer("android", () => Effect.fail(failure))),
      Effect.flip
    );

    assert.strictEqual(error, failure);
  })
);

it.effect(
  "returns native schedule warnings and IDs without losing future warning codes",
  () =>
    Effect.gen(function* () {
      for (const code of ["OS-PLUG-LNOT-0017", "future-warning", undefined]) {
        const result = {
          notifications: [{ id: 22 }],
        };

        if (code !== undefined) {
          Object.assign(result, {
            warning: {
              code,
              message: "Scheduled as an inexact alarm instead.",
            },
          });
        }

        const layer = Layer.merge(
          unusedBrowser,
          bridgeTestLayer("android", (_plugin, method) =>
            Effect.succeed(
              method === "checkPermissions" ? { display: "granted" } : result
            )
          )
        );

        assert.deepStrictEqual(
          yield* scheduleNotification(reminder).pipe(Effect.provide(layer)),
          result
        );
      }
    })
);

it.effect("rejects malformed schedule warnings with a typed decode error", () =>
  Effect.gen(function* () {
    const layer = Layer.merge(
      unusedBrowser,
      bridgeTestLayer("android", (_plugin, method) =>
        Effect.succeed(
          method === "checkPermissions"
            ? { display: "granted" }
            : {
                notifications: [{ id: 22 }],
                warning: { code: 17, message: "Invalid" },
              }
        )
      )
    );

    const error = yield* scheduleNotification(reminder).pipe(
      Effect.provide(layer),
      Effect.flip
    );

    assert.strictEqual(error._tag, "BridgeDecodeError");
  })
);
