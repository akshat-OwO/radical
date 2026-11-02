// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { vi } from "vite-plus/test";

import { bridgeTestLayer } from "../../src/core/bridge/bridge.ts";
import { useHideSplash } from "../../src/react/react.ts";
import { mountHook } from "../fixtures/mounted-hook.ts";

/** Frames run only when the test flushes them, so no real timer is involved. */
const manualFrames = Effect.acquireRelease(
  Effect.sync(() => {
    const pending = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
      next += 1;
      pending.set(next, frame);

      return next;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      pending.delete(handle);
    });

    return {
      flush: Effect.gen(function* () {
        // Let fibers waiting on the previous frame request the next one.
        yield* Effect.yieldNow;
        const due = [...pending.values()];
        pending.clear();

        for (const frame of due) {
          frame(0);
        }

        yield* Effect.yieldNow;
      }),
    };
  }),
  () =>
    Effect.sync(() => {
      vi.unstubAllGlobals();
    })
);

it.effect("hides once when ready turns true, after two painted frames", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const frames = yield* manualFrames;
      const calls: unknown[] = [];
      let ready = false;

      const layer = bridgeTestLayer("ios", (plugin, method) =>
        Effect.sync(() => {
          calls.push({ plugin, method });
        })
      );

      const hook = yield* mountHook(() => useHideSplash(ready), layer);

      yield* frames.flush;
      yield* frames.flush;
      assert.deepStrictEqual(calls, []);

      ready = true;
      hook.render();
      yield* frames.flush;
      assert.deepStrictEqual(calls, []);
      yield* frames.flush;
      yield* Effect.yieldNow;
      assert.deepStrictEqual(calls, [
        { plugin: "RadicalSplash", method: "hide" },
      ]);

      hook.render();
      yield* frames.flush;
      yield* frames.flush;
      assert.strictEqual(calls.length, 1);
    })
  )
);

it.effect("returns a stable hide function that resolves after the call", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const frames = yield* manualFrames;
      const calls: unknown[] = [];

      const layer = bridgeTestLayer("android", (plugin, method) =>
        Effect.sync(() => {
          calls.push({ plugin, method });
        })
      );

      const hook = yield* mountHook(() => useHideSplash(), layer);
      const hide = hook.state();
      hook.render();
      assert.strictEqual(hook.state(), hide);

      const done = yield* Effect.forkChild(Effect.promise(hide));
      yield* frames.flush;
      yield* frames.flush;
      yield* Fiber.join(done);
      assert.deepStrictEqual(calls, [
        { plugin: "RadicalSplash", method: "hide" },
      ]);
    })
  )
);
