// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { TestClock } from "effect/testing";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../src/core/bridge/bridge.ts";
import { RadicalProvider, useHapticFeedback } from "../../src/react/react.ts";
import type { HapticFeedbackState } from "../../src/react/react.ts";

it.effect("exposes stable helpers for every style and reports failures", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let state: HapticFeedbackState | undefined;
      let settled = yield* Deferred.make<boolean>();
      const calls: unknown[] = [];
      let reject = false;

      const layer = bridgeTestLayer("android", (plugin, method, options) => {
        calls.push({ method, options });

        return reject
          ? Effect.fail(
              new BridgeCallFailed({ plugin, method, cause: "failed" })
            )
          : Effect.void;
      });

      const Probe = () => {
        const feedback = useHapticFeedback();
        useLayoutEffect(() => {
          state = feedback;

          if (feedback.value || feedback.failure) {
            const signal = settled;
            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(signal, true));
            });
          }
        }, [feedback]);

        return null;
      };

      const root = createRoot(document.createElement("div"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          flushSync(() => {
            root.unmount();
          });
        })
      );
      flushSync(() => {
        root.render(
          createElement(RadicalProvider, { layer }, createElement(Probe))
        );
      });
      const initial = state;
      assert.isDefined(initial);

      for (const helper of [
        "light",
        "medium",
        "heavy",
        "success",
        "warning",
        "error",
        "selection",
        "impact",
      ] as const) {
        settled = yield* Deferred.make<boolean>();
        flushSync(() => {
          initial[helper]();
        });
        yield* Deferred.await(settled);
        assert.strictEqual(state?.[helper], initial[helper]);
        assert.isUndefined(state?.failure);
      }

      assert.deepStrictEqual(calls, [
        ...["LIGHT", "MEDIUM", "HEAVY"].map((style) => ({
          method: "impact",
          options: { style },
        })),
        ...["SUCCESS", "WARNING", "ERROR"].map((type) => ({
          method: "notification",
          options: { type },
        })),
        ...["selectionStart", "selectionChanged", "selectionEnd"].map(
          (method) => ({ method, options: {} })
        ),
        { method: "impact", options: { style: "MEDIUM" } },
      ]);
      reject = true;
      settled = yield* Deferred.make<boolean>();
      flushSync(() => {
        initial.light();
      });
      yield* Deferred.await(settled);
      assert.strictEqual(state?.failure?._tag, "BridgeCallFailed");
      assert.isUndefined(state?.value);
    })
  )
);

it.effect(
  "suppresses overlapping haptics and interrupts on provider replacement and unmount",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let state: HapticFeedbackState | undefined;
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

        const Probe = () => {
          const feedback = useHapticFeedback();
          useLayoutEffect(() => {
            state = feedback;
          }, [feedback]);

          return null;
        };

        const root = createRoot(document.createElement("div"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );

        const render = () => {
          flushSync(() => {
            root.render(
              createElement(
                RadicalProvider,
                { layer: layer() },
                createElement(Probe)
              )
            );
          });
        };

        render();
        const stale = state?.light;
        state?.light();
        state?.heavy();
        yield* TestClock.adjust("1 second");
        assert.strictEqual(calls, 1);
        render();
        yield* TestClock.adjust("1 second");
        assert.strictEqual(interrupted, 1);
        stale?.();
        state?.light();
        yield* TestClock.adjust("1 second");
        assert.strictEqual(calls, 2);
        flushSync(() => {
          root.unmount();
        });
        yield* TestClock.adjust("1 second");
        assert.strictEqual(interrupted, 2);
        state?.light();
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(calls, 2);
      })
    )
);
