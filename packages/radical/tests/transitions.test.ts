import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import {
  BrowserTransitions,
  cancelBrowserTransition,
  watchBrowserTransition,
  TransitionFailed,
} from "../src/client.ts";
import type { BrowserTransition } from "../src/client.ts";

const fixture = Effect.gen(function* () {
  const skips = yield* Ref.make(0);
  const started = yield* Deferred.make<boolean>();
  const layer = (finished: BrowserTransition["finished"]) =>
    Layer.succeed(BrowserTransitions, {
      supportsTypes: Effect.succeed(true),
      active: Deferred.succeed(started, true).pipe(
        Effect.as(
          Option.some({ finished, skip: Ref.update(skips, (n) => n + 1) })
        )
      ),
    });
  return { skips, started, layer };
});

describe("browser transition controls", () => {
  it.effect("does nothing when there is no active transition", () =>
    Effect.gen(function* () {
      yield* watchBrowserTransition(100);
      yield* cancelBrowserTransition;
    }).pipe(
      Effect.provide(
        Layer.succeed(BrowserTransitions, {
          supportsTypes: Effect.succeed(true),
          active: Effect.succeed(Option.none()),
        })
      )
    )
  );

  it.effect("ignores rejected animation completion", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      yield* watchBrowserTransition(100).pipe(
        Effect.provide(
          state.layer(Effect.fail(new TransitionFailed({ cause: "skipped" })))
        )
      );
      assert.strictEqual(yield* Ref.get(state.skips), 0);
    })
  );

  it.effect("skips a stalled animation only when its timeout expires", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const fiber = yield* Effect.forkChild(
        watchBrowserTransition(100).pipe(
          Effect.provide(state.layer(Effect.never))
        )
      );
      yield* Deferred.await(state.started);
      yield* TestClock.adjust(99);
      assert.strictEqual(yield* Ref.get(state.skips), 0);
      yield* TestClock.adjust(1);
      yield* Fiber.join(fiber);
      assert.strictEqual(yield* Ref.get(state.skips), 1);
    })
  );

  it.effect("cancels the active animation through skipTransition", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      yield* cancelBrowserTransition.pipe(
        Effect.provide(state.layer(Effect.never))
      );
      assert.strictEqual(yield* Ref.get(state.skips), 1);
    })
  );

  it.effect("stops the timeout after animation finishes", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const finished = yield* Deferred.make<boolean>();
      const fiber = yield* Effect.forkChild(
        watchBrowserTransition(100).pipe(
          Effect.provide(
            state.layer(Deferred.await(finished).pipe(Effect.asVoid))
          )
        )
      );
      yield* Deferred.await(state.started);
      yield* TestClock.adjust(10);
      yield* Deferred.succeed(finished, true);
      yield* Fiber.join(fiber);
      yield* TestClock.adjust(100);
      assert.strictEqual(yield* Ref.get(state.skips), 0);
    })
  );
});
