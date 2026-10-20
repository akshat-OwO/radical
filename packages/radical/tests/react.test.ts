// @vitest-environment happy-dom
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import type { Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  BridgeCallFailed,
  bridgeTestLayer,
  browserDeviceInfo,
} from "../src/client.ts";
import type { Bridge } from "../src/client.ts";
import { useDeviceInfo } from "../src/react.ts";
import type { DeviceInfoState } from "../src/react.ts";

/** Completion follows a committed React update, never a timer or polling loop. */
const mount = (layer: Layer.Layer<Bridge>) =>
  Effect.gen(function* () {
    const completed = yield* Deferred.make<DeviceInfoState>();
    const container = document.createElement("div");
    const root = createRoot(container);
    const states: DeviceInfoState[] = [];
    const Probe = () => {
      const state = useDeviceInfo(layer);
      useLayoutEffect(() => {
        states.push(state);
        if (!state.loading) {
          // Resume the test after React finishes the commit, before any timer.
          queueMicrotask(() => {
            Effect.runSync(Deferred.succeed(completed, state));
          });
        }
      }, [state]);
      return null;
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        flushSync(() => {
          root.unmount();
        });
      })
    );
    flushSync(() => {
      root.render(createElement(Probe));
    });
    return {
      completed,
      states,
      unmount: () => {
        flushSync(() => {
          root.unmount();
        });
      },
    };
  });

describe(useDeviceInfo, () => {
  it.effect(
    "loads browser-derived info without calling the native bridge",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const layer = bridgeTestLayer("browser", () =>
            Effect.sync(() => assert.fail("browser called native bridge"))
          );
          const mounted = yield* mount(layer);
          const state = yield* Deferred.await(mounted.completed);
          assert.strictEqual(mounted.states[0].loading, true);
          assert.deepStrictEqual(state, {
            loading: false,
            value: browserDeviceInfo(navigator),
            error: undefined,
          });
        })
      )
  );
  it.effect("exposes a typed bridge error after loading", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const error = new BridgeCallFailed({
          plugin: "Device",
          method: "getInfo",
          cause: { code: "UNAVAILABLE" },
        });
        const mounted = yield* mount(
          bridgeTestLayer("android", () => Effect.fail(error))
        );
        const state = yield* Deferred.await(mounted.completed);
        assert.strictEqual(mounted.states[0].loading, true);
        assert.deepStrictEqual(state, {
          loading: false,
          value: undefined,
          error,
        });
        assert.instanceOf(state.error, BridgeCallFailed);
      })
    )
  );
  it.effect("interrupts an in-flight bridge call on unmount", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<boolean>();
        const interrupted = yield* Deferred.make<boolean>();
        const mounted = yield* mount(
          bridgeTestLayer("android", () =>
            Deferred.succeed(started, true).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, true))
            )
          )
        );
        yield* Deferred.await(started);
        mounted.unmount();
        yield* Deferred.await(interrupted);
        assert.strictEqual(mounted.states.length, 1);
        assert.strictEqual(mounted.states[0].loading, true);
      })
    )
  );
});
