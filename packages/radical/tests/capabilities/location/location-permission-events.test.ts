import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Queue } from "effect";

import { LocationPermissionEventsLive } from "../../../src/capabilities/location/location-permission-events-live.ts";
import { LocationPermissionEvents } from "../../../src/capabilities/location/location-permission-events.ts";
import type { LocationPermission } from "../../../src/capabilities/location/location-schema.ts";
import { Bridge } from "../../../src/core/bridge/bridge.ts";
import { locationFixture } from "./fixture.ts";

it.effect(
  "Android resume refreshes actual permission grants while location services remain off",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        native.control.servicesEnabled = false;

        yield* Effect.gen(function* () {
          const events = yield* LocationPermissionEvents;
          const received = yield* Queue.unbounded<LocationPermission>();
          yield* events.listen((permission) => {
            Queue.offerUnsafe(received, permission);
          });

          native.state.coarseLocation = "granted";
          native.active(true);
          assert.deepStrictEqual(yield* Queue.take(received), {
            state: "granted",
            precision: "approximate",
          });

          native.state.location = "granted";
          native.active(true);
          assert.deepStrictEqual(yield* Queue.take(received), {
            state: "granted",
            precision: "precise",
          });

          native.state.location = "denied";
          native.state.coarseLocation = "denied";
          native.active(true);
          assert.deepStrictEqual(yield* Queue.take(received), {
            state: "denied",
            precision: "unknown",
          });
          assert.deepStrictEqual(
            native.calls.map(({ plugin, method }) => ({ plugin, method })),
            Array.from({ length: 3 }, () => ({
              plugin: "RadicalLocation",
              method: "checkPermissions",
            }))
          );
        }).pipe(
          Effect.provide(
            LocationPermissionEventsLive.pipe(Layer.provide(native.layer))
          )
        );
      })
    )
);

it.effect(
  "permission subscribers share one foreground refresh and release lifecycle observation with the last subscriber",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();

        yield* Effect.gen(function* () {
          const events = yield* LocationPermissionEvents;
          const first = yield* Queue.unbounded<LocationPermission>();
          const second = yield* Queue.unbounded<LocationPermission>();

          const checks = () =>
            native.calls.filter((call) => call.method === "checkPermissions")
              .length;

          const subscribe = (queue: Queue.Queue<LocationPermission>) =>
            Effect.gen(function* () {
              const ready = yield* Deferred.make<boolean>();

              const fiber = yield* Effect.scoped(
                Effect.gen(function* () {
                  yield* events.listen((permission) => {
                    Queue.offerUnsafe(queue, permission);
                  });
                  yield* Deferred.succeed(ready, true);

                  return yield* Effect.never;
                })
              ).pipe(Effect.forkChild);

              yield* Deferred.await(ready);

              return fiber;
            });

          native.active(true);
          assert.strictEqual(native.activityListeners(), 0);
          assert.strictEqual(checks(), 0);
          const firstFiber = yield* subscribe(first);
          const secondFiber = yield* subscribe(second);
          assert.strictEqual(native.activityStarted(), 1);
          assert.strictEqual(native.activityListeners(), 1);
          native.state.coarseLocation = "granted";
          native.active(false);
          native.active(true);
          assert.deepStrictEqual(yield* Queue.take(first), {
            state: "granted",
            precision: "approximate",
          });
          assert.deepStrictEqual(yield* Queue.take(second), {
            state: "granted",
            precision: "approximate",
          });
          assert.strictEqual(checks(), 1);

          yield* Fiber.interrupt(firstFiber);
          assert.strictEqual(native.activityListeners(), 1);
          native.state.location = "granted";
          native.active(true);
          assert.deepStrictEqual(yield* Queue.take(second), {
            state: "granted",
            precision: "precise",
          });
          assert.strictEqual(checks(), 2);
          yield* Fiber.interrupt(secondFiber);
          assert.strictEqual(yield* Queue.take(native.activityReleases), 1);
          assert.strictEqual(native.activityListeners(), 0);
          native.active(true);
          assert.strictEqual(checks(), 2);

          // A later subscriber reuses the service and acquires a fresh lifecycle listener.
          const thirdFiber = yield* subscribe(first);
          assert.strictEqual(native.activityStarted(), 2);
          assert.deepStrictEqual(yield* Queue.take(first), {
            state: "granted",
            precision: "precise",
          });
          native.state.location = "denied";
          native.state.coarseLocation = "denied";
          native.active(true);
          assert.deepStrictEqual(yield* Queue.take(first), {
            state: "denied",
            precision: "unknown",
          });
          assert.strictEqual(checks(), 3);
          yield* Fiber.interrupt(thirdFiber);
          assert.strictEqual(yield* Queue.take(native.activityReleases), 2);
        }).pipe(
          Effect.provide(
            LocationPermissionEventsLive.pipe(Layer.provide(native.layer))
          )
        );
      })
    )
);

it.effect(
  "a delayed resume check cannot overwrite a newer permission publication",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const bridge = yield* Bridge.pipe(Effect.provide(native.layer));
        const checking = yield* Deferred.make<boolean>();
        const response = yield* Deferred.make<boolean>();
        const completed = yield* Deferred.make<boolean>();

        const layer = Layer.succeed(Bridge, {
          ...bridge,
          call: (plugin, method, options) =>
            method === "checkPermissions"
              ? Deferred.succeed(checking, true).pipe(
                  Effect.andThen(Deferred.await(response)),
                  Effect.andThen(bridge.call(plugin, method, options)),
                  Effect.ensuring(Deferred.succeed(completed, true))
                )
              : bridge.call(plugin, method, options),
        });

        yield* Effect.gen(function* () {
          const events = yield* LocationPermissionEvents;
          const received: LocationPermission[] = [];
          yield* events.listen((permission) => {
            received.push(permission);
          });
          native.active(true);
          yield* Deferred.await(checking);
          events.publish({ state: "granted", precision: "precise" });
          yield* Deferred.succeed(response, true);
          yield* Deferred.await(completed);
          // Drain the refresh fiber through its publication step.
          yield* Effect.yieldNow;
          assert.deepStrictEqual(received, [
            { state: "granted", precision: "precise" },
          ]);
        }).pipe(
          Effect.provide(
            LocationPermissionEventsLive.pipe(Layer.provide(layer))
          )
        );
      })
    )
);
