// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";

import { bridgeLayer } from "../../src/core/bridge/bridge.ts";
import { Unavailable } from "../../src/core/errors.ts";
import * as plain from "../../src/plain/client.ts";
import { createEffectRuntime } from "../../src/plain/runtime.ts";

it.effect(
  "Plain browser commands reject and watch reports Unavailable without native listeners",
  () =>
    Effect.gen(function* () {
      let adds = 0;
      let removes = 0;
      let calls = 0;

      const runtime = createEffectRuntime(
        bridgeLayer(
          () => ({
            getPlatform: () => "browser",
            nativePromise: async () => {
              calls += 1;

              return await Effect.runPromise(Effect.succeed({}));
            },
            nativeCallback: (_plugin, method) => {
              if (method === "addListener") {
                adds += 1;
              }

              if (method === "removeListener") {
                removes += 1;
              }

              return "callback";
            },
          }),
          undefined,
          () => {}
        )
      );

      yield* Effect.acquireUseRelease(
        Effect.succeed(runtime),
        () =>
          Effect.gen(function* () {
            for (const invoke of [
              async () =>
                await plain.startTrackingSession(
                  { preset: "balanced" },
                  runtime
                ),
              async () => await plain.getTrackingSession(runtime),
              async () => await plain.stopTrackingSession("old", runtime),
            ]) {
              const error = yield* Effect.tryPromise({
                try: invoke,
                catch: (cause) => ({ cause }),
              }).pipe(Effect.flip);

              assert.instanceOf(error.cause, Unavailable);
            }

            const received = yield* Deferred.make<unknown>();

            const unsubscribe = plain.watchTrackingSession(
              () => {
                assert.fail("Unexpected snapshot");
              },
              (error) => {
                Effect.runSync(Deferred.succeed(received, error));
              },
              runtime
            );

            yield* Effect.acquireUseRelease(
              Effect.succeed(unsubscribe),
              () =>
                Deferred.await(received).pipe(
                  Effect.tap((error) =>
                    Effect.sync(() => {
                      assert.instanceOf(error, Unavailable);
                    })
                  )
                ),
              (release) => Effect.sync(release)
            );
          }),
        () =>
          Effect.promise(async () => {
            await runtime.dispose();
          })
      );
      assert.strictEqual(adds, 0);
      assert.strictEqual(removes, 0);
      assert.strictEqual(calls, 0);
    })
);
