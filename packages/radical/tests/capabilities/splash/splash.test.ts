import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import {
  SplashPaint,
  hideSplash,
} from "../../../src/capabilities/splash/splash.ts";
import {
  BridgeCallFailed,
  BridgeUnavailable,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";

const unexpected = () =>
  Effect.sync(() => assert.fail("Unexpected native call"));

const painted = Effect.provideService(SplashPaint, { painted: Effect.void });

it.effect("does nothing in a browser, without waiting for a paint", () =>
  hideSplash.pipe(
    Effect.provide(bridgeTestLayer("browser", unexpected)),
    Effect.provideService(SplashPaint, {
      painted: Effect.sync(() => assert.fail("Unexpected paint wait")),
    })
  )
);

it.effect("asks both shells to hide only after the page painted", () =>
  Effect.gen(function* () {
    for (const runtime of ["android", "ios"] as const) {
      const calls: unknown[] = [];
      const paint = yield* Deferred.make<boolean>();

      const fiber = yield* hideSplash.pipe(
        Effect.provide(
          bridgeTestLayer(runtime, (plugin, method, options) =>
            Effect.sync(() => {
              calls.push({ plugin, method, options });
            })
          )
        ),
        Effect.provideService(SplashPaint, {
          painted: Effect.asVoid(Deferred.await(paint)),
        }),
        Effect.forkChild
      );

      yield* Effect.yieldNow;
      assert.deepStrictEqual(calls, []);

      yield* Deferred.succeed(paint, true);
      yield* Fiber.join(fiber);
      assert.deepStrictEqual(calls, [
        { plugin: "RadicalSplash", method: "hide", options: {} },
      ]);
    }
  })
);

it.effect("treats a shell without the splash command as already hidden", () =>
  hideSplash.pipe(
    Effect.provide(
      bridgeTestLayer("ios", (plugin, method) =>
        Effect.fail(new BridgeUnavailable({ plugin, method }))
      )
    ),
    painted
  )
);

it.effect("reports a failed native hide", () =>
  Effect.gen(function* () {
    const error = yield* hideSplash.pipe(
      Effect.provide(
        bridgeTestLayer("android", (plugin, method) =>
          Effect.fail(new BridgeCallFailed({ plugin, method, cause: "boom" }))
        )
      ),
      painted,
      Effect.flip
    );

    assert.strictEqual(error._tag, "BridgeCallFailed");
  })
);
