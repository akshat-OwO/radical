import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import {
  BrowserTransitions,
  runBrowserTransition,
  TransitionFailed,
} from "../src/client.ts";
import type { BrowserTransition } from "../src/client.ts";

const slide = { kind: "slide", direction: "forward" } as const;

const fixture = Effect.gen(function* () {
  const commits = yield* Ref.make(0);
  const skips = yield* Ref.make(0);
  const started = yield* Deferred.make<boolean>();
  const callback = yield* Deferred.make<() => Promise<void>>();
  const layer = (finished: BrowserTransition["finished"]) =>
    Layer.succeed(BrowserTransitions, {
      start: (_transition, update) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(callback, update);
          yield* Deferred.succeed(started, true);
          return Option.some({
            finished,
            skip: Ref.update(skips, (n) => n + 1),
          });
        }),
    });
  return {
    commits,
    skips,
    started,
    callback,
    layer,
    update: Ref.update(commits, (n) => n + 1),
  };
});

describe("browser transitions", () => {
  it.effect("commits normally when view transitions are unsupported", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      yield* runBrowserTransition(slide, state.update).pipe(
        Effect.provide(
          Layer.succeed(BrowserTransitions, {
            start: () => Effect.succeed(Option.none()),
          })
        )
      );
      assert.strictEqual(yield* Ref.get(state.commits), 1);
    })
  );

  it.effect("commits when starting a view transition fails", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      yield* runBrowserTransition(slide, state.update).pipe(
        Effect.provide(
          Layer.succeed(BrowserTransitions, {
            start: () =>
              Effect.fail(new TransitionFailed({ cause: "capture failed" })),
          })
        )
      );
      assert.strictEqual(yield* Ref.get(state.commits), 1);
    })
  );

  it.effect("commits and skips when a view transition rejects", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      yield* runBrowserTransition(slide, state.update).pipe(
        Effect.provide(
          state.layer(
            Effect.fail(new TransitionFailed({ cause: "finished rejected" }))
          )
        )
      );
      assert.strictEqual(yield* Ref.get(state.commits), 1);
      assert.strictEqual(yield* Ref.get(state.skips), 1);
    })
  );

  it.effect(
    "times out a stalled capture and ignores its late update callback",
    () =>
      Effect.gen(function* () {
        const state = yield* fixture;
        const fiber = yield* Effect.forkChild(
          runBrowserTransition(slide, state.update, 100).pipe(
            Effect.provide(state.layer(Effect.never))
          )
        );
        yield* Deferred.await(state.started);
        yield* TestClock.adjust(99);
        assert.strictEqual(yield* Ref.get(state.commits), 0);
        yield* TestClock.adjust(1);
        yield* Fiber.join(fiber);
        assert.strictEqual(yield* Ref.get(state.skips), 1);
        assert.strictEqual(yield* Ref.get(state.commits), 1);
        const late = yield* Deferred.await(state.callback);
        yield* Effect.promise(late);
        assert.strictEqual(yield* Ref.get(state.commits), 1);
      })
  );

  it.effect("cancels before the timeout and still commits exactly once", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const fiber = yield* Effect.forkChild(
        runBrowserTransition(slide, state.update, 100).pipe(
          Effect.provide(state.layer(Effect.never))
        )
      );
      yield* Deferred.await(state.started);
      yield* TestClock.adjust(10);
      yield* Fiber.interrupt(fiber);
      assert.strictEqual(yield* Ref.get(state.skips), 1);
      assert.strictEqual(yield* Ref.get(state.commits), 1);
      const late = yield* Deferred.await(state.callback);
      yield* Effect.promise(late);
      yield* TestClock.adjust(100);
      assert.strictEqual(yield* Ref.get(state.commits), 1);
      assert.strictEqual(yield* Ref.get(state.skips), 1);
    })
  );

  it.effect(
    "commits only once when the browser invokes update before finishing",
    () =>
      Effect.gen(function* () {
        const state = yield* fixture;
        const finished = yield* Deferred.make<boolean>();
        const fiber = yield* Effect.forkChild(
          runBrowserTransition(slide, state.update).pipe(
            Effect.provide(
              state.layer(Deferred.await(finished).pipe(Effect.asVoid))
            )
          )
        );
        const update = yield* Deferred.await(state.callback);
        yield* Effect.promise(update);
        assert.strictEqual(yield* Ref.get(state.commits), 1);
        yield* Deferred.succeed(finished, true);
        yield* Fiber.join(fiber);
        assert.strictEqual(yield* Ref.get(state.commits), 1);
      })
  );
});
