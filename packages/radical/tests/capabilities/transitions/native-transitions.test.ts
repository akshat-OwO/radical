import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref, Option } from "effect";
import { TestClock } from "effect/testing";

import { BrowserTransitions } from "../../../src/capabilities/transitions/browser-transitions.ts";
import { TransitionFailed } from "../../../src/capabilities/transitions/errors.ts";
import {
  NativeTransitions,
  NativeTransitionsLive,
  nativeTransition,
} from "../../../src/capabilities/transitions/native-transitions.ts";
import { transitionStrategy } from "../../../src/capabilities/transitions/transition-strategy.ts";
import { NavigationFailed } from "../../../src/core/adapter/errors.ts";
import { bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";
import { ignoredBack } from "../../fixtures/native-back.ts";

const transition = { kind: "slide", direction: "back" } as const;

const fixture = Effect.gen(function* () {
  const calls = yield* Ref.make<string[]>([]);

  const record = (name: string) =>
    Ref.update(calls, (values) => [...values, name]);

  const service: NativeTransitions["Service"] = {
    ...ignoredBack,
    nextId: Effect.succeed("one"),
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
            ...ignoredBack,
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
              ...ignoredBack,
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

  it.effect("allows a slow commit to finish and removes the overlay", () =>
    Effect.gen(function* () {
      const state = yield* fixture;
      const started = yield* Deferred.make<boolean>();
      const committed = yield* Deferred.make<string>();

      const fiber = yield* Effect.forkChild(
        nativeTransition(
          "one",
          transition,
          Deferred.succeed(started, true).pipe(
            Effect.andThen(Deferred.await(committed))
          ),
          100
        ).pipe(Effect.provideService(NativeTransitions, state.service))
      );

      yield* Deferred.await(started);
      yield* TestClock.adjust(5000);
      assert.deepStrictEqual(yield* Ref.get(state.calls), ["cover"]);
      yield* Deferred.succeed(committed, "destination");
      assert.strictEqual(yield* Fiber.join(fiber), "destination");
      assert.deepStrictEqual(yield* Ref.get(state.calls), [
        "cover",
        "painted",
        "slide:back",
        "remove",
      ]);
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
              ...ignoredBack,
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
              ...ignoredBack,
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

  it.effect("mints unique overlay ids across live layer rebuilds", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<string[]>([]);

      const bridge = bridgeTestLayer("ios", (_plugin, method, options) =>
        Ref.update(calls, (values) => [
          ...values,
          `${method}:${String(options.id)}`,
        ]).pipe(Effect.as({ id: options.id }))
      );

      const layer = NativeTransitionsLive.pipe(Layer.provide(bridge));

      const overlay = Effect.gen(function* () {
        const native = yield* NativeTransitions;
        const id = yield* native.nextId;
        yield* native.cover(id);
        yield* native.reveal(id, transition);
        yield* native.remove(id);

        return id;
      });

      const ids: string[] = [];

      for (let index = 0; index < 3; index += 1) {
        ids.push(yield* overlay.pipe(Effect.provide(layer)));
      }

      assert.strictEqual(new Set(ids).size, 3);
      assert.strictEqual(BigInt(ids[1]), BigInt(ids[0]) + 1n);
      assert.strictEqual(BigInt(ids[2]), BigInt(ids[1]) + 1n);
      assert.deepStrictEqual(
        yield* Ref.get(calls),
        ids.flatMap((id) => [`cover:${id}`, `reveal:${id}`, `remove:${id}`])
      );
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
