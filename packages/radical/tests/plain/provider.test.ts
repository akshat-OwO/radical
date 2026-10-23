// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { StrictMode, createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { Bridge, bridgeTestLayer } from "../../src/core/bridge/bridge.ts";
import {
  createEffectRuntime,
  defaultRuntime,
  getEffectRuntime,
} from "../../src/plain/runtime.ts";
import type { RadicalRuntime } from "../../src/plain/runtime.ts";
import {
  RadicalProvider,
  useRadicalRuntime,
} from "../../src/react/use-bridge-effect.ts";

const trackedBridge = Effect.gen(function* () {
  const released = yield* Deferred.make<boolean>();

  const bridge = yield* Bridge.pipe(
    Effect.provide(bridgeTestLayer("android", () => Effect.never))
  );

  return {
    released,
    layer: Layer.effect(
      Bridge,
      Effect.acquireRelease(Effect.succeed(bridge), () =>
        Deferred.succeed(released, true)
      )
    ),
  };
});

const harness = Effect.gen(function* () {
  const root = createRoot(document.createElement("div"));
  let current = defaultRuntime;

  const Probe = () => {
    const runtime = useRadicalRuntime();
    useLayoutEffect(() => {
      current = runtime;
    }, [runtime]);

    return null;
  };

  const unmount = () => {
    flushSync(() => {
      root.unmount();
    });
  };

  yield* Effect.addFinalizer(() => Effect.sync(unmount));

  return {
    unmount,
    render: (layer: Layer.Layer<Bridge>, runtime?: RadicalRuntime) => {
      flushSync(() => {
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(
              RadicalProvider,
              { layer, runtime },
              createElement(Probe)
            )
          )
        );
      });
      assert.notStrictEqual(current, defaultRuntime);

      return current;
    },
  };
});

const readBridge = (runtime: RadicalRuntime) =>
  Effect.promise(
    async () =>
      await getEffectRuntime(runtime).runPromise(
        Bridge.pipe(Effect.flatMap((bridge) => bridge.runtime))
      )
  );

it.effect("StrictMode replay leaves the owned runtime usable", () =>
  Effect.gen(function* () {
    const { layer } = yield* trackedBridge;
    const view = yield* harness;
    const runtime = view.render(layer);

    assert.strictEqual(yield* readBridge(runtime), "android");
  }).pipe(Effect.scoped)
);

it.effect("unmount disposes the owned runtime", () =>
  Effect.gen(function* () {
    const { layer, released } = yield* trackedBridge;
    const view = yield* harness;
    const runtime = view.render(layer);
    yield* readBridge(runtime);
    view.unmount();
    yield* Deferred.await(released);
  }).pipe(Effect.scoped)
);

it.effect("changing the layer disposes the previous owned runtime", () =>
  Effect.gen(function* () {
    const first = yield* trackedBridge;
    const second = yield* trackedBridge;
    const view = yield* harness;
    const previous = view.render(first.layer);
    yield* readBridge(previous);
    const next = view.render(second.layer);
    yield* Deferred.await(first.released);
    assert.notStrictEqual(previous, next);
    assert.strictEqual(yield* readBridge(next), "android");
    assert.isFalse(yield* Deferred.isDone(second.released));
  }).pipe(Effect.scoped)
);

it.effect(
  "a supplied runtime stays caller-owned across prop changes and unmount",
  () =>
    Effect.gen(function* () {
      const first = yield* trackedBridge;
      const second = yield* trackedBridge;
      const supplied = createEffectRuntime(first.layer);
      yield* Effect.addFinalizer(() => Effect.promise(supplied.dispose));
      const view = yield* harness;
      assert.strictEqual(view.render(first.layer, supplied), supplied);
      yield* readBridge(supplied);
      assert.strictEqual(view.render(second.layer, supplied), supplied);
      view.render(second.layer);
      view.unmount();
      assert.isFalse(yield* Deferred.isDone(first.released));
      assert.strictEqual(yield* readBridge(supplied), "android");
    }).pipe(Effect.scoped)
);

it.effect("supplying a runtime disposes the previous owned runtime", () =>
  Effect.gen(function* () {
    const first = yield* trackedBridge;
    const second = yield* trackedBridge;
    const supplied = createEffectRuntime(second.layer);
    yield* Effect.addFinalizer(() => Effect.promise(supplied.dispose));
    const view = yield* harness;
    yield* readBridge(view.render(first.layer));
    assert.strictEqual(view.render(first.layer, supplied), supplied);
    yield* Deferred.await(first.released);
    assert.strictEqual(yield* readBridge(supplied), "android");
  }).pipe(Effect.scoped)
);
