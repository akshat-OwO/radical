// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { flushSync } from "react-dom";

import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../src/core/bridge/bridge.ts";
import {
  useExactAlarmPermission,
  useNotificationPermission,
  useNotifications,
} from "../../src/react/react.ts";
import { mountHook } from "../fixtures/mounted-hook.ts";

it.effect(
  "checks notification permission on mount and replacement, and exposes stable check and request actions",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let settled = yield* Deferred.make<boolean>();
        const calls: string[] = [];
        let granted = false;
        let failed = false;
        const layer = () =>
          bridgeTestLayer("ios", (plugin, method) => {
            calls.push(method);
            if (failed) {
              return Effect.fail(
                new BridgeCallFailed({ plugin, method, cause: "denied" })
              );
            }
            if (method === "requestPermissions") {
              granted = true;
            }
            return Effect.succeed({ display: granted ? "granted" : "prompt" });
          });
        const mounted = yield* mountHook(
          useNotificationPermission,
          layer(),
          (state) => {
            if (state.value !== undefined || state.error !== undefined) {
              const signal = settled;
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(signal, true));
              });
            }
          }
        );
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().value, "prompt");
        const initial = mounted.state();
        settled = yield* Deferred.make<boolean>();
        flushSync(() => {
          initial.request();
        });
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().value, "granted");
        assert.strictEqual(mounted.state().request, initial.request);
        assert.strictEqual(mounted.state().check, initial.check);
        settled = yield* Deferred.make<boolean>();
        flushSync(() => {
          initial.check();
        });
        yield* Deferred.await(settled);
        settled = yield* Deferred.make<boolean>();
        failed = true;
        mounted.render(layer());
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().error?._tag, "BridgeCallFailed");
        assert.isUndefined(mounted.state().value);
        assert.deepStrictEqual(calls, [
          "checkPermissions",
          "requestPermissions",
          "checkPermissions",
          "checkPermissions",
        ]);
      })
    )
);

it.effect(
  "routes notification actions to native plugins and exposes results and typed failures",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let settled = yield* Deferred.make<boolean>();
        let failed = false;
        const calls: {
          plugin: string;
          method: string;
          options: Parameters<Parameters<typeof bridgeTestLayer>[1]>[2];
        }[] = [];
        yield* TestClock.setTime(1000);
        const clock = yield* Clock.Clock;
        const layer = Layer.merge(
          Layer.succeed(Clock.Clock, clock),
          bridgeTestLayer("android", (plugin, method, options) => {
            calls.push({ plugin, method, options });
            if (failed) {
              return Effect.fail(
                new BridgeCallFailed({ plugin, method, cause: "failed" })
              );
            }
            const results = new Map([
              ["checkPermissions", { display: "granted" }],
              ["schedule", {
                notifications: [{ id: 1 }],
                warning: { code: "OS-PLUG-LNOT-0017", message: "Inexact alarm" },
              }],
              ["isSupported", { isSupported: true }],
              ["status", { configured: true }],
              ["getToken", { token: "token" }],
              ["list", { topics: ["news"] }],
            ]);
            return Effect.succeed(results.get(method));
          })
        );
        const mounted = yield* mountHook(useNotifications, layer, (state) => {
          if (state.value !== undefined || state.error !== undefined) {
            const signal = settled;
            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(signal, true));
            });
          }
        });
        const initial = mounted.state();
        const actions = [
          () => {
            initial.schedule({
              id: 1,
              title: "Title",
              body: "Body",
              route: "/notes",
              delaySeconds: 60,
            });
          },
          () => {
            initial.cancel(1);
          },
          () => {
            initial.setBadge(3);
          },
          initial.clearBadge,
          initial.registerPush,
          () => {
            initial.subscribe("news");
          },
          () => {
            initial.unsubscribe("news");
          },
          initial.lookupTopics,
        ];
        for (const action of actions) {
          settled = yield* Deferred.make<boolean>();
          flushSync(action);
          yield* Deferred.await(settled);
          assert.isUndefined(mounted.state().error);
          if (action === actions[0]) {
            assert.deepStrictEqual(mounted.state().value, {
              notifications: [{ id: 1 }],
              warning: { code: "OS-PLUG-LNOT-0017", message: "Inexact alarm" },
            });
          }
          for (const key of [
            "schedule",
            "cancel",
            "setBadge",
            "clearBadge",
            "registerPush",
            "subscribe",
            "unsubscribe",
            "lookupTopics",
          ] as const) {
            assert.strictEqual(mounted.state()[key], initial[key]);
          }
        }
        assert.deepStrictEqual(mounted.state().value, ["news"]);
        assert.deepStrictEqual(
          calls.map((call) => call.method),
          [
            "checkPermissions",
            "schedule",
            "cancel",
            "isSupported",
            "set",
            "isSupported",
            "set",
            "status",
            "checkPermissions",
            "getToken",
            "status",
            "subscribe",
            "status",
            "list",
            "status",
            "unsubscribe",
            "status",
            "list",
            "status",
            "list",
          ]
        );
        assert.deepStrictEqual(calls[1], {
          plugin: "LocalNotifications",
          method: "schedule",
          options: {
            notifications: [
              {
                id: 1,
                title: "Title",
                body: "Body",
                schedule: { at: "1970-01-01T00:01:01.000Z" },
                extra: { route: "/notes" },
              },
            ],
          },
        });
        assert.deepStrictEqual(calls[2], {
          plugin: "LocalNotifications",
          method: "cancel",
          options: { notifications: [{ id: 1 }] },
        });
        settled = yield* Deferred.make<boolean>();
        failed = true;
        flushSync(initial.lookupTopics);
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().error?._tag, "BridgeCallFailed");
        assert.isUndefined(mounted.state().value);
      })
    )
);

it.effect(
  "suppresses overlapping notification actions and interrupts work on provider replacement and unmount",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        let interrupted = 0;
        const layer = () =>
          bridgeTestLayer("ios", () =>
            Effect.sync(() => {
              calls += 1;
            }).pipe(
              Effect.andThen(Effect.sleep("1 minute")),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted += 1;
                })
              )
            )
          );
        const mounted = yield* mountHook(useNotifications, layer());
        const stale = mounted.state().cancel;
        stale(1);
        mounted.state().cancel(2);
        yield* TestClock.adjust("1 second");
        assert.strictEqual(calls, 1);
        mounted.render(layer());
        yield* TestClock.adjust("1 second");
        assert.strictEqual(interrupted, 1);
        stale(3);
        mounted.state().cancel(4);
        yield* TestClock.adjust("1 second");
        assert.strictEqual(calls, 2);
        const retired = mounted.state().cancel;
        mounted.unmount();
        yield* TestClock.adjust("1 second");
        assert.strictEqual(interrupted, 2);
        retired(5);
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(calls, 2);
      })
    )
);

it.effect(
  "refreshes exact-alarm consent on mount and after returning from settings",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let settled = yield* Deferred.make<boolean>();
        const calls: string[] = [];
        const mounted = yield* mountHook(
          useExactAlarmPermission,
          bridgeTestLayer("android", (plugin, method) => {
            assert.strictEqual(plugin, "LocalNotifications");
            calls.push(method);
            return Effect.succeed({
              exact_alarm:
                method === "changeExactNotificationSetting"
                  ? "granted"
                  : "denied",
            });
          }),
          (state) => {
            if (state.value !== undefined) {
              const signal = settled;
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(signal, true));
              });
            }
          }
        );
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().value, "denied");
        const initial = mounted.state();
        settled = yield* Deferred.make<boolean>();
        flushSync(initial.request);
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().value, "granted");
        assert.strictEqual(mounted.state().request, initial.request);
        assert.strictEqual(mounted.state().check, initial.check);
        settled = yield* Deferred.make<boolean>();
        flushSync(initial.check);
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().value, "denied");
        assert.deepStrictEqual(calls, [
          "checkExactNotificationSetting",
          "changeExactNotificationSetting",
          "checkExactNotificationSetting",
        ]);
      })
    )
);
