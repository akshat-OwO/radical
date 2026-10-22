// @vitest-environment happy-dom
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  Bridge,
  BridgeCallFailed,
  bridgeTestLayer,
  browserDeviceInfo,
  getDeviceInfo,
} from "../../src/entry/client.ts";
import {
  RadicalProvider,
  useDeviceInfo,
  useSafeArea,
} from "../../src/react/react.ts";
import type { DeviceInfoState } from "../../src/react/react.ts";
import { useBridgeEffect } from "../../src/react/use-bridge-effect.ts";

const useTestEffect = () => useBridgeEffect(getDeviceInfo);

/** Completion follows a committed React update, never a timer or polling loop. */
const mount = (layer?: Layer.Layer<Bridge>, hook = useTestEffect, copies = 1) =>
  Effect.gen(function* () {
    const completed = yield* Deferred.make<DeviceInfoState>();
    const container = document.createElement("div");
    const root = createRoot(container);
    const states: DeviceInfoState[] = [];
    const Probe = () => {
      const state = hook();
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
    const render = (nextLayer = layer) => {
      flushSync(() => {
        const probes = Array.from({ length: copies }, (_, key) =>
          createElement(Probe, { key })
        );
        root.render(
          nextLayer
            ? createElement(RadicalProvider, { layer: nextLayer }, probes)
            : createElement(Probe)
        );
      });
    };
    render();
    return {
      completed,
      states,
      render,
      unmount: () => {
        flushSync(() => {
          root.unmount();
        });
      },
    };
  });

describe(useBridgeEffect, () => {
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

describe(RadicalProvider, () => {
  it.effect(
    "shares a bridge across hooks and keeps it stable on re-render",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let calls = 0;
          const layer = bridgeTestLayer("android", () =>
            Effect.sync(() => {
              calls += 1;
              return {
                platform: "android",
                model: "test",
                operatingSystem: "android",
                osVersion: "16",
                manufacturer: "test",
                isVirtual: true,
              };
            })
          );
          const mounted = yield* mount(layer, useDeviceInfo, 2);
          yield* Deferred.await(mounted.completed);
          assert.strictEqual(calls, 2);
          mounted.render();
          yield* Effect.yieldNow;
          assert.strictEqual(calls, 2);
          assert.strictEqual(
            mounted.states.filter((state) => !state.loading).length,
            2
          );
        })
      )
  );
  it.effect(
    "interrupts the old layer and returns loading when the provider changes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<boolean>();
          const interrupted = yield* Deferred.make<boolean>();
          const layer = bridgeTestLayer("android", () =>
            Deferred.succeed(started, true).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, true))
            )
          );
          const mounted = yield* mount(layer);
          yield* Deferred.await(started);
          mounted.render(
            bridgeTestLayer("browser", () =>
              Effect.sync(() => assert.fail("unexpected native call"))
            )
          );
          assert.strictEqual(mounted.states.at(-1)?.loading, true);
          yield* Deferred.await(interrupted);
          const state = yield* Deferred.await(mounted.completed);
          assert.deepStrictEqual(state.value, browserDeviceInfo(navigator));
        })
      )
  );
  it.effect("clears a completed value when the provider layer changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mounted = yield* mount(
          bridgeTestLayer("browser", () => Effect.never)
        );
        const first = yield* Deferred.await(mounted.completed);
        assert.isDefined(first.value);
        const started = yield* Deferred.make<boolean>();
        mounted.render(
          bridgeTestLayer("android", () =>
            Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never))
          )
        );
        assert.deepStrictEqual(mounted.states.at(-1), {
          loading: true,
          value: undefined,
          error: undefined,
        });
        yield* Deferred.await(started);
      })
    )
  );
  it.effect("uses BridgeLive without a provider", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mounted = yield* mount(undefined, useDeviceInfo);
        const state = yield* Deferred.await(mounted.completed);
        assert.deepStrictEqual(state.value, browserDeviceInfo(navigator));
      })
    )
  );
});

it.effect(
  "starts with provider insets and reads updates without mutating CSS",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initial = { top: 62, right: 0, bottom: 34, left: 0 };
        const rotated = { top: 0, right: 62, bottom: 21, left: 62 };
        const updated = yield* Deferred.make<boolean>();
        let publish: ((value: unknown) => void) | undefined;
        let removed = false;
        const layer = Layer.succeed(Bridge, {
          runtime: Effect.succeed("ios" as const),
          call: () => Effect.never,
          observe: (_event, receive) =>
            Effect.sync(() => {
              publish = receive;
              receive(initial);
              return () => {
                removed = true;
              };
            }),
        });
        const container = document.createElement("div");
        const root = createRoot(container);
        const priorStyle = document.documentElement.style.cssText;
        const values: unknown[] = [];
        const AreaProbe = () => {
          const area = useSafeArea();
          useLayoutEffect(() => {
            values.push(area);
            if (area === rotated || area.left === rotated.left) {
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(updated, true));
              });
            }
          }, [area]);
          return createElement("pre", null, JSON.stringify(area));
        };
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
            document.documentElement.style.cssText = priorStyle;
          })
        );
        flushSync(() => {
          root.render(
            createElement(
              RadicalProvider,
              {
                layer,
                nativeContext: {
                  platform: "ios",
                  safeArea: initial,
                  shellVersion: "1",
                },
              },
              createElement(AreaProbe)
            )
          );
        });
        assert.deepStrictEqual(values[0], initial);
        publish?.(rotated);
        yield* Deferred.await(updated);
        assert.strictEqual(document.documentElement.style.cssText, priorStyle);
        assert.deepStrictEqual(values.at(-1), rotated);
        flushSync(() => {
          root.unmount();
        });
        yield* Effect.yieldNow;
        assert.isTrue(removed);
      })
    )
);
