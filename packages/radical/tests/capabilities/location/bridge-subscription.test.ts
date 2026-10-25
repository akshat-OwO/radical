import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Schema } from "effect";
import { TestClock } from "effect/testing";

import { Bridge, bridgeLayer } from "../../../src/core/bridge/bridge.ts";
import type {
  BridgeError,
  InjectedBridge,
} from "../../../src/core/bridge/bridge.ts";

it.effect(
  "callback subscriptions decode values, preserve errors and ignore late callbacks after release",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const values =
          yield* Queue.unbounded<
            Effect.Effect<{ readonly latitude: number }, BridgeError>
          >();

        const calls: {
          method: string;
          options: Parameters<Bridge["Service"]["call"]>[2];
        }[] = [];

        let receive: Parameters<
          NonNullable<InjectedBridge["nativeCallback"]>
        >[3];

        const layer = bridgeLayer(() => ({
          getPlatform: () => "ios",
          nativePromise: () => {
            assert.fail("Callback subscriptions must not use nativePromise");
          },
          nativeCallback: (_plugin, method, options, listener) => {
            calls.push({ method, options });

            if (method === "watchPosition") {
              receive = listener;
            }

            return "native-watch-1";
          },
        }));

        yield* Effect.gen(function* () {
          const bridge = yield* Bridge;
          assert.isDefined(bridge.subscribe);

          const release = yield* bridge.subscribe(
            "Geolocation",
            "watchPosition",
            {},
            Schema.Struct({ latitude: Schema.Finite }),
            (result) => {
              Queue.offerUnsafe(values, result);
            },
            { method: "clearWatch", key: "id" }
          );

          receive?.({ latitude: 51 });
          assert.deepStrictEqual(yield* yield* Queue.take(values), {
            latitude: 51,
          });
          receive?.({ latitude: "broken" });
          assert.strictEqual(
            (yield* Effect.flip(yield* Queue.take(values)))._tag,
            "BridgeDecodeError"
          );
          receive?.(null, { code: "OS-PLUG-GLOC-0007" });
          assert.strictEqual(
            (yield* Effect.flip(yield* Queue.take(values)))._tag,
            "BridgeCallFailed"
          );
          yield* release;
          receive?.({ latitude: 52 });
          assert.strictEqual(yield* Queue.size(values), 0);
          assert.deepStrictEqual(calls, [
            { method: "watchPosition", options: {} },
            { method: "clearWatch", options: { id: "native-watch-1" } },
            { method: "clearWatch", options: { id: "native-watch-1" } },
          ]);
        }).pipe(Effect.provide(layer));
      })
    )
);

it.effect(
  "scoped callback acquisition releases even when interruption arrives before acquisition completes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const acquired = yield* Queue.unbounded<boolean>();
        let released = 0;

        const fiber = yield* Effect.acquireRelease(
          Effect.sleep(100).pipe(
            Effect.tap(() => Queue.offer(acquired, true)),
            Effect.as(
              Effect.sync(() => {
                released += 1;
              })
            )
          ),
          (release) => release
        ).pipe(Effect.andThen(Effect.never), Effect.scoped, Effect.forkChild);

        const interrupt = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
        yield* TestClock.adjust(100);
        yield* Fiber.join(interrupt);
        assert.strictEqual(yield* Queue.take(acquired), true);
        assert.strictEqual(released, 1);
      })
    )
);
