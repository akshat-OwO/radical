import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref, Option } from "effect";
import { TestClock } from "effect/testing";

import { bridgeTestLayer } from "../src/bridge.ts";
import { BrowserTransitions } from "../src/browser-transitions.ts";
import {
  NativeTransitions,
  NativeTransitionsLive,
  nativeTransition,
} from "../src/native-transitions.ts";
import { NavigationFailed } from "../src/navigation-error.ts";
import { TransitionFailed } from "../src/transition-error.ts";
import { transitionStrategy } from "../src/transition-strategy.ts";

const transition = { kind: "slide", direction: "back" } as const;
const fixture = Effect.gen(function* () {
  const calls = yield* Ref.make<string[]>([]);
  const record = (name: string) =>
    Ref.update(calls, (values) => [...values, name]);
  const service: NativeTransitions["Service"] = {
    cover: () => record("cover"),
    painted: record("painted"),
    reveal: (_id, value) => record(`${value.kind}:${value.direction}`),
    remove: () => record("remove"),
  };
  return { calls, record, service, commit: record("commit") };
});

describe("native snapshot transitions", () => {
  it.effect("covers before commit and reveals only after paint", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      yield* nativeTransition("one", transition, state.commit).pipe(
        Effect.provide(Layer.succeed(NativeTransitions, state.service))
      );
      assert.deepStrictEqual(yield* Ref.get(state.calls), [
        "cover",
        "commit",
        "painted",
        "slide:back",
        "remove",
      ]);
    })
  );

  it.effect("removes a failed capture and commits once without animation", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      yield* nativeTransition("one", transition, state.commit).pipe(
        Effect.provide(
          Layer.succeed(NativeTransitions, {
            ...state.service,
            cover: () =>
              Effect.fail(new TransitionFailed({ cause: "capture" })),
          })
        )
      );
      assert.deepStrictEqual(yield* Ref.get(state.calls), ["remove", "commit"]);
    })
  );

  it.effect("removes a timed out capture before plain navigation", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const started = yield* Deferred.make<boolean>();
      const fiber = yield* Effect.forkChild(
        nativeTransition("one", transition, state.commit, 100).pipe(
          Effect.provide(
            Layer.succeed(NativeTransitions, {
              ...state.service,
              cover: () =>
                Deferred.succeed(started, true).pipe(
                  Effect.andThen(Effect.never)
                ),
            })
          )
        )
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust(99);
      assert.deepStrictEqual(yield* Ref.get(state.calls), []);
      yield* TestClock.adjust(1);
      yield* Fiber.join(fiber);
      assert.deepStrictEqual(yield* Ref.get(state.calls), ["remove", "commit"]);
    })
  );

  it.effect("preserves navigation failure and always removes the overlay", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const error = new NavigationFailed({ cause: "commit" });
      const result = yield* Effect.flip(
        nativeTransition("one", transition, Effect.fail(error)).pipe(
          Effect.provide(Layer.succeed(NativeTransitions, state.service))
        )
      );
      assert.strictEqual(result, error);
      assert.deepStrictEqual(yield* Ref.get(state.calls), ["cover", "remove"]);
    })
  );

  it.effect("returns a typed commit timeout and removes the overlay", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const started = yield* Deferred.make<boolean>();
      const fiber = yield* Effect.forkChild(
        Effect.flip(
          nativeTransition(
            "one",
            transition,
            Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never)),
            100
          ).pipe(
            Effect.provide(Layer.succeed(NativeTransitions, state.service))
          )
        )
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust(100);
      const error = yield* Fiber.join(fiber);
      assert.strictEqual(error._tag, "TransitionTimeout");
      assert.deepStrictEqual(yield* Ref.get(state.calls), ["cover", "remove"]);
    })
  );

  it.effect("leaves the committed route visible when reveal stalls", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const started = yield* Deferred.make<boolean>();
      const fiber = yield* Effect.forkChild(
        nativeTransition(
          "one",
          { kind: "fade", direction: "forward" },
          state.commit,
          100
        ).pipe(
          Effect.provide(
            Layer.succeed(NativeTransitions, {
              ...state.service,
              reveal: () =>
                Deferred.succeed(started, true).pipe(
                  Effect.andThen(Effect.never)
                ),
            })
          )
        )
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust(100);
      yield* Fiber.join(fiber);
      assert.deepStrictEqual(yield* Ref.get(state.calls), [
        "cover",
        "commit",
        "painted",
        "remove",
      ]);
    })
  );

  it.effect("removes the overlay on interruption during paint", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const started = yield* Deferred.make<boolean>();
      const fiber = yield* Effect.forkChild(
        nativeTransition("one", transition, state.commit).pipe(
          Effect.provide(
            Layer.succeed(NativeTransitions, {
              ...state.service,
              painted: Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never)
              ),
            })
          )
        )
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      assert.deepStrictEqual(yield* Ref.get(state.calls), [
        "cover",
        "commit",
        "remove",
      ]);
    })
  );

  it.effect("rejects malformed and mismatched bridge acknowledgements", () =>
    Effect.gen(function* () {
      for (const result of [{ id: 42 }, { id: "other" }]) {
        const error = yield* Effect.flip(
          Effect.gen(function* () {
            const native = yield* NativeTransitions;
            yield* native.cover("one");
          }).pipe(
            Effect.provide(
              NativeTransitionsLive.pipe(
                Layer.provide(
                  bridgeTestLayer("ios", () => Effect.succeed(result))
                )
              )
            )
          )
        );
        assert.strictEqual(error._tag, "TransitionFailed");
      }
    })
  );
});

it.effect(
  "selects native in both shells even without WebView transitions",
  () =>
    Effect.gen(function* () {
      for (const platform of ["ios", "android", "browser"] as const) {
        const strategy = yield* transitionStrategy.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer(platform, () =>
                Effect.die("No native command during strategy selection")
              ),
              Layer.succeed(BrowserTransitions, {
                supportsTypes: Effect.succeed(false),
                active: Effect.succeed(Option.none()),
              })
            )
          )
        );
        assert.strictEqual(
          strategy,
          platform === "browser" ? "plain" : "native"
        );
      }
    })
);

it.effect("bounds cleanup when the bridge never acknowledges removal", () =>
  Effect.gen(function* () {
    const state = yield* fixture;
    const removing = yield* Deferred.make<boolean>();
    const fiber = yield* Effect.forkChild(
      nativeTransition("one", transition, state.commit, 100).pipe(
        Effect.provideService(NativeTransitions, {
          ...state.service,
          remove: () =>
            Deferred.succeed(removing, true).pipe(Effect.andThen(Effect.never)),
        })
      )
    );
    yield* Deferred.await(removing);
    yield* TestClock.adjust(100);
    yield* Fiber.join(fiber);
    assert.deepStrictEqual(yield* Ref.get(state.calls), [
      "cover",
      "commit",
      "painted",
      "slide:back",
    ]);
  })
);
