import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  BrowserHaptics,
  BrowserHapticsLive,
  hapticImpact,
  hapticNotification,
  hapticSelection,
} from "../../../src/capabilities/haptics/haptics.ts";
import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";
import {
  PluginModules,
  resolvePlugins,
} from "../../../src/vite/plugins/plugin-plan.ts";

const unexpected = () =>
  Effect.sync(() => assert.fail("Unexpected native call"));

const actions = [
  hapticImpact("LIGHT"),
  hapticImpact(),
  hapticImpact("HEAVY"),
  hapticNotification("SUCCESS"),
  hapticNotification("WARNING"),
  hapticNotification("ERROR"),
  hapticSelection,
];

const resolve = (haptics?: boolean) =>
  resolvePlugins({
    appId: "dev.test.app",
    internalPlugins: { haptics },
  }).pipe(Effect.provideService(PluginModules, { load: unexpected }));

it.effect(
  "calls every haptic style and selection lifecycle in both shells",
  () =>
    Effect.gen(function* () {
      for (const runtime of ["android", "ios"] as const) {
        const calls: unknown[] = [];

        const layer = bridgeTestLayer(runtime, (plugin, method, options) =>
          Effect.sync(() => {
            calls.push({ plugin, method, options });
          })
        );

        for (const action of actions) {
          yield* action.pipe(
            Effect.provide(layer),
            Effect.provideService(BrowserHaptics, { vibrate: unexpected })
          );
        }

        assert.deepStrictEqual(calls, [
          ...["LIGHT", "MEDIUM", "HEAVY"].map((style) => ({
            plugin: "Haptics",
            method: "impact",
            options: { style },
          })),
          ...["SUCCESS", "WARNING", "ERROR"].map((type) => ({
            plugin: "Haptics",
            method: "notification",
            options: { type },
          })),
          ...["selectionStart", "selectionChanged", "selectionEnd"].map(
            (method) => ({ plugin: "Haptics", method, options: {} })
          ),
        ]);
      }
    })
);

it.effect("uses browser vibration patterns without calling the bridge", () =>
  Effect.gen(function* () {
    const patterns: (readonly number[])[] = [];

    for (const action of actions) {
      yield* action.pipe(
        Effect.provide(bridgeTestLayer("browser", unexpected)),
        Effect.provideService(BrowserHaptics, {
          vibrate: (pattern) =>
            Effect.sync(() => {
              patterns.push(pattern);
            }),
        })
      );
    }

    assert.deepStrictEqual(patterns, [
      [10],
      [20],
      [30],
      [10, 50, 10],
      [30, 50, 30],
      [50, 50, 50, 50, 50],
      [10],
    ]);
  })
);

it.effect("does nothing without a browser vibration API", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      typeof navigator === "undefined" || navigator.vibrate === undefined,
      true
    );

    for (const action of actions) {
      yield* action.pipe(
        Effect.provide(
          Layer.merge(
            bridgeTestLayer("browser", unexpected),
            BrowserHapticsLive
          )
        )
      );
    }
  })
);

it.effect(
  "preserves native failures and rejects invalid arguments in every runtime",
  () =>
    Effect.gen(function* () {
      const failure = new BridgeCallFailed({
        plugin: "Haptics",
        method: "impact",
        cause: { code: "UNIMPLEMENTED" },
      });

      const error = yield* hapticImpact().pipe(
        Effect.provide(
          Layer.merge(
            bridgeTestLayer("ios", () => Effect.fail(failure)),
            BrowserHapticsLive
          )
        ),
        Effect.flip
      );

      assert.strictEqual(error, failure);
      // Exercise the Schema boundary used by JavaScript callers.
      // @ts-expect-error Invalid style must also be rejected at runtime.
      const invalid = hapticImpact("STRONG");
      // @ts-expect-error Invalid type must also be rejected at runtime.
      const invalidNotification = hapticNotification("INFO");

      for (const runtime of ["android", "ios", "browser"] as const) {
        const patterns: (readonly number[])[] = [];

        for (const action of [invalid, invalidNotification]) {
          const decodeError = yield* action.pipe(
            Effect.provide(bridgeTestLayer(runtime, unexpected)),
            Effect.provideService(BrowserHaptics, {
              vibrate: (pattern) =>
                Effect.sync(() => {
                  patterns.push(pattern);
                }),
            }),
            Effect.flip
          );

          assert.strictEqual(decodeError._tag, "BridgeDecodeError");
        }

        assert.deepStrictEqual(patterns, []);
      }
    })
);

for (const inFlight of ["selectionStart", "selectionChanged"] as const) {
  it.effect(
    `releases a native selection generator when ${inFlight} is interrupted`,
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];

        const fiber = yield* hapticSelection.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("ios", (_plugin, method) =>
                Effect.sync(() => {
                  calls.push(method);
                }).pipe(
                  Effect.andThen(
                    method === inFlight ? Effect.sleep("1 minute") : Effect.void
                  )
                )
              ),
              BrowserHapticsLive
            )
          ),
          Effect.forkChild
        );

        yield* TestClock.adjust("1 second");
        assert.strictEqual(calls.at(-1), inFlight);
        yield* Fiber.interrupt(fiber);
        assert.deepStrictEqual(
          calls,
          inFlight === "selectionStart"
            ? ["selectionStart", "selectionEnd"]
            : ["selectionStart", "selectionChanged", "selectionEnd"]
        );
      })
  );
}

for (const failedMethod of ["selectionStart", "selectionChanged"] as const) {
  it.effect(
    `preserves ${failedMethod} failure when releasing the generator also fails`,
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];

        const failure = new BridgeCallFailed({
          plugin: "Haptics",
          method: failedMethod,
          cause: "action failed",
        });

        const cleanupFailure = new BridgeCallFailed({
          plugin: "Haptics",
          method: "selectionEnd",
          cause: "cleanup failed",
        });

        const error = yield* hapticSelection.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("ios", (_plugin, method) =>
                Effect.sync(() => {
                  calls.push(method);
                }).pipe(
                  Effect.andThen(() => {
                    if (method === failedMethod) {
                      return Effect.fail(failure);
                    }

                    return method === "selectionEnd"
                      ? Effect.fail(cleanupFailure)
                      : Effect.void;
                  })
                )
              ),
              BrowserHapticsLive
            )
          ),
          Effect.flip
        );

        assert.strictEqual(error, failure);
        assert.deepStrictEqual(
          calls,
          failedMethod === "selectionStart"
            ? ["selectionStart", "selectionEnd"]
            : ["selectionStart", "selectionChanged", "selectionEnd"]
        );
      })
  );
}

it.effect("enables only the opted-in pinned Haptics manifest", () =>
  Effect.gen(function* () {
    for (const enabled of [undefined, false]) {
      assert.notInclude(
        (yield* resolve(enabled)).map(({ manifest }) => manifest.id),
        "haptics"
      );
    }

    const plugin = (yield* resolve(true)).find(
      ({ manifest }) => manifest.id === "haptics"
    );

    assert.deepStrictEqual(plugin?.manifest.dependencies, {
      "@capacitor/haptics": "8.0.2",
    });
    assert.strictEqual(plugin?.selector, "hapticsPlugin");
  })
);
