// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { TestClock } from "effect/testing";
import { flushSync } from "react-dom";

import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../src/core/bridge/bridge.ts";
import { useDataProtection } from "../../src/react/react.ts";
import { mountHook } from "../fixtures/mounted-hook.ts";

it.effect(
  "exposes stable data protection actions, updates policy and reports typed failures",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let settled = yield* Deferred.make<boolean>();
        const calls: unknown[] = [];
        let failed = false;
        const layer = bridgeTestLayer("android", (plugin, method, options) => {
          calls.push({ plugin, method, options });
          return failed
            ? Effect.fail(
                new BridgeCallFailed({ plugin, method, cause: "failed" })
              )
            : Effect.succeed({
                enabled: options?.enabled,
                screenshots: true,
                recording: true,
                appSwitcher: true,
              });
        });
        const mounted = yield* mountHook(useDataProtection, layer, (state) => {
          if (state.value !== undefined || state.error !== undefined) {
            const signal = settled;
            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(signal, true));
            });
          }
        });
        const initial = mounted.state();
        for (const enabled of [true, false]) {
          settled = yield* Deferred.make<boolean>();
          flushSync(() => {
            initial.setEnabled(enabled);
          });
          yield* Deferred.await(settled);
          assert.deepStrictEqual(mounted.state().value, {
            enabled,
            screenshots: true,
            recording: true,
            appSwitcher: true,
          });
          assert.strictEqual(mounted.state().setEnabled, initial.setEnabled);
          assert.strictEqual(
            mounted.state().clearWebData,
            initial.clearWebData
          );
        }
        settled = yield* Deferred.make<boolean>();
        failed = true;
        flushSync(() => {
          initial.setEnabled(true);
        });
        yield* Deferred.await(settled);
        assert.strictEqual(mounted.state().error?._tag, "BridgeCallFailed");
        assert.isUndefined(mounted.state().value);
        assert.deepStrictEqual(
          calls,
          [true, false, true].map((enabled) => ({
            plugin: "RadicalDataProtection",
            method: "setProtection",
            options: { enabled },
          }))
        );
        mounted.unmount();
        assert.lengthOf(calls, 3);
      })
    )
);

it.effect(
  "suppresses overlapping policy changes and interrupts work on provider replacement and unmount without disabling protection",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: unknown[] = [];
        let interrupted = 0;
        const layer = () =>
          bridgeTestLayer("ios", (_plugin, method, options) =>
            Effect.sync(() => {
              calls.push({ method, options });
            }).pipe(
              Effect.andThen(Effect.sleep("1 minute")),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted += 1;
                })
              )
            )
          );
        const mounted = yield* mountHook(useDataProtection, layer());
        const stale = mounted.state().setEnabled;
        stale(true);
        mounted.state().setEnabled(false);
        yield* TestClock.adjust("1 second");
        assert.lengthOf(calls, 1);
        mounted.render(layer());
        yield* TestClock.adjust("1 second");
        assert.strictEqual(interrupted, 1);
        stale(false);
        mounted.state().setEnabled(true);
        yield* TestClock.adjust("1 second");
        const retired = mounted.state().setEnabled;
        mounted.unmount();
        yield* TestClock.adjust("1 second");
        assert.strictEqual(interrupted, 2);
        retired(false);
        yield* TestClock.adjust("1 minute");
        assert.deepStrictEqual(calls, [
          { method: "setProtection", options: { enabled: true } },
          { method: "setProtection", options: { enabled: true } },
        ]);
      })
    )
);

it.effect(
  "clears browser data before invoking native clearing and returns success through the mounted hook",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settled = yield* Deferred.make<boolean>();
        const calls: string[] = [];
        const layer = bridgeTestLayer("ios", (_plugin, method) =>
          Effect.sync(() => {
            calls.push(method);
            assert.isNull(localStorage.getItem("private"));
            assert.isNull(sessionStorage.getItem("private"));
          })
        );
        const mounted = yield* mountHook(useDataProtection, layer, (state) => {
          if (state.value !== undefined || state.error !== undefined) {
            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(settled, true));
            });
          }
        });
        localStorage.setItem("private", "local");
        sessionStorage.setItem("private", "session");
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            localStorage.clear();
            sessionStorage.clear();
          })
        );
        flushSync(mounted.state().clearWebData);
        yield* Deferred.await(settled);
        assert.isUndefined(mounted.state().error);
        assert.strictEqual(mounted.state().value, true);
        assert.deepStrictEqual(calls, ["clearWebData"]);
      })
    )
);
