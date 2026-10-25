import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Queue, Result, Stream } from "effect";
import { TestClock } from "effect/testing";

import { browserLocationLayer } from "../../../src/capabilities/location/browser-location.ts";
import {
  LocationWatchPoolLive,
  locationLive,
  watchLocationEvents,
} from "../../../src/capabilities/location/location-pool.ts";
import {
  checkLocationPermission,
  requestLocationPermission,
} from "../../../src/capabilities/location/location.ts";
import type { LocationError } from "../../../src/capabilities/location/location.ts";
import {
  installNavigatorLocation,
  browserPosition,
} from "../../../src/capabilities/location/navigator-location.ts";
import { Bridge, bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";
import { watchLocation as watchPlain } from "../../../src/plain/client.ts";
import {
  createEffectRuntime,
  getEffectRuntime,
} from "../../../src/plain/runtime.ts";
import { fix, locationFixture } from "./fixture.ts";

for (const platform of ["android", "ios"] as const) {
  it.effect(
    `${platform} Plain watches reacquire after timeout and deliver later fixes to the same subscriber`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture(platform);
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const fixes = yield* Queue.unbounded<number>();
          const errors = yield* Queue.unbounded<LocationError>();

          const stop = watchPlain(
            (value) => {
              Queue.offerUnsafe(fixes, value.timestamp);
            },
            (error) => {
              Queue.offerUnsafe(errors, error);
            },
            {},
            runtime
          );

          yield* Effect.addFinalizer(() => Effect.sync(stop));
          assert.strictEqual(yield* Queue.take(fixes), 100);

          native.control.emitInitialFix = false;

          for (const [code, tag] of [
            ["0010", "LocationTimeout"],
            ["0002", "Unavailable"],
            ["0007", "LocationServicesOff"],
          ] as const) {
            native.fail(`OS-PLUG-GLOC-${code}`);
            assert.strictEqual((yield* Queue.take(errors))._tag, tag);

            if (code === "0010") {
              assert.strictEqual(yield* Queue.take(native.releases), 1);
              assert.strictEqual(native.liveSubscriptions(), 0);
              native.emit({ ...fix, timestamp: 999 });
              assert.strictEqual(yield* Queue.size(fixes), 0);
              yield* TestClock.adjust(100);
              assert.strictEqual(yield* Queue.take(native.starts), 1);
              assert.strictEqual(yield* Queue.take(native.starts), 2);
            }

            assert.strictEqual(native.released(), 1);
            native.emit({ ...fix, timestamp: 200 });
            assert.strictEqual(yield* Queue.take(fixes), 200);
            assert.strictEqual(native.count(), 2);
          }

          native.fail("OS-PLUG-GLOC-0003");
          assert.strictEqual(
            (yield* Queue.take(errors))._tag,
            "PermissionDenied"
          );
          assert.strictEqual(yield* Queue.take(native.releases), 2);
        })
      )
  );

  it.effect(
    `${platform} navigator retains its watch ID through native timeout recovery until clearWatch`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture(platform);
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));

          const target: Pick<Navigator, "geolocation" | "permissions"> = {
            geolocation: {
              getCurrentPosition: () =>
                assert.fail("Unexpected browser acquisition"),
              watchPosition: () => assert.fail("Unexpected browser watch"),
              clearWatch: () => assert.fail("Unexpected browser clear"),
            },
            permissions: {
              query: async () =>
                await Effect.runPromise(
                  Effect.die("Unexpected browser permission query")
                ),
            },
          };

          const restore = yield* installNavigatorLocation(target, runtime);
          yield* Effect.addFinalizer(() => restore);
          const fixes = yield* Queue.unbounded<number>();
          const errors = yield* Queue.unbounded<number>();

          const id = target.geolocation.watchPosition(
            (value) => {
              Queue.offerUnsafe(fixes, value.timestamp);
            },
            (failure) => {
              Queue.offerUnsafe(errors, failure.code);
            }
          );

          assert.strictEqual(yield* Queue.take(fixes), 100);

          native.control.emitInitialFix = false;

          for (const [code, expected] of [
            ["0010", 3],
            ["0002", 2],
            ["0007", 2],
          ] as const) {
            native.fail(`OS-PLUG-GLOC-${code}`);
            assert.strictEqual(yield* Queue.take(errors), expected);

            if (code === "0010") {
              assert.strictEqual(yield* Queue.take(native.releases), 1);
              assert.strictEqual(native.liveSubscriptions(), 0);
              native.emit({ ...fix, timestamp: 999 });
              assert.strictEqual(yield* Queue.size(fixes), 0);
              yield* TestClock.adjust(100);
              assert.strictEqual(yield* Queue.take(native.starts), 1);
              assert.strictEqual(yield* Queue.take(native.starts), 2);
            }

            assert.strictEqual(native.released(), 1);
            native.emit({ ...fix, timestamp: 200 });
            assert.strictEqual(yield* Queue.take(fixes), 200);
            assert.strictEqual(native.count(), 2);
          }

          native.fail("OS-PLUG-GLOC-0010");
          assert.strictEqual(yield* Queue.take(errors), 3);
          assert.strictEqual(yield* Queue.take(native.releases), 2);
          target.geolocation.clearWatch(id);
          yield* TestClock.adjust(60_000);
          assert.strictEqual(native.count(), 2);
        })
      )
  );
}

it.effect(
  "browser pool watches retain the browser subscription across timeout and unavailable errors but end on denial",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const acquired = yield* Deferred.make<boolean>();
        const values = yield* Queue.unbounded<string>();
        let receive: PositionCallback | undefined;
        let fail: PositionErrorCallback | null | undefined;
        let released = 0;

        const geo: Geolocation = {
          getCurrentPosition: () =>
            assert.fail("Unexpected one-shot acquisition"),
          watchPosition: (success, error) => {
            receive = success;
            fail = error;
            Effect.runSync(Deferred.succeed(acquired, true));

            return 7;
          },
          clearWatch: (id) => {
            assert.strictEqual(id, 7);
            released += 1;
          },
        };

        const layer = LocationWatchPoolLive.pipe(
          Layer.provide(
            Layer.merge(
              bridgeTestLayer("browser", () =>
                Effect.die("Unexpected native call")
              ),
              browserLocationLayer(() => ({ geolocation: geo }))
            )
          )
        );

        const fiber = yield* watchLocationEvents().pipe(
          Stream.runForEach((event) =>
            Queue.offer(
              values,
              Result.isFailure(event)
                ? event.failure._tag
                : String(event.success.timestamp)
            )
          ),
          Effect.catchTag("PermissionDenied", () =>
            Queue.offer(values, "PermissionDenied")
          ),
          Effect.provide(layer),
          Effect.forkChild
        );

        yield* Deferred.await(acquired);

        const position = browserPosition({
          ...fix.coords,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          timestamp: 100,
        });

        receive?.(position);
        assert.strictEqual(yield* Queue.take(values), "100");

        for (const [code, tag] of [
          [3, "LocationTimeout"],
          [2, "Unavailable"],
        ] as const) {
          fail?.({
            code,
            message: "Acquisition failed",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
          assert.strictEqual(yield* Queue.take(values), tag);
          assert.strictEqual(released, 0);
          receive?.(position);
          assert.strictEqual(yield* Queue.take(values), "100");
        }

        fail?.({
          code: 1,
          message: "Revoked",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
        assert.strictEqual(yield* Queue.take(values), "PermissionDenied");
        yield* Fiber.join(fiber);
        assert.strictEqual(released, 1);
      })
    )
);

for (const enableHighAccuracy of [true, false]) {
  it.effect(
    `a delayed precise grant updates shared native options only when high accuracy was requested (${enableHighAccuracy})`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture();
          native.state.coarseLocation = "granted";
          const bridge = yield* Bridge.pipe(Effect.provide(native.layer));
          const requested = yield* Deferred.make<boolean>();
          const decision = yield* Deferred.make<boolean>();

          const runtime = createEffectRuntime(
            Layer.succeed(Bridge, {
              ...bridge,
              call: (plugin, method, options) =>
                method === "requestPermissions"
                  ? Deferred.succeed(requested, true).pipe(
                      Effect.andThen(Deferred.await(decision)),
                      Effect.andThen(bridge.call(plugin, method, options))
                    )
                  : bridge.call(plugin, method, options),
            })
          );

          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const managed = getEffectRuntime(runtime);
          const first = yield* Queue.unbounded<number>();
          const second = yield* Queue.unbounded<number>();

          const subscribe = (queue: Queue.Queue<number>) =>
            watchPlain(
              (value) => {
                Queue.offerUnsafe(queue, value.timestamp);
              },
              (error) => {
                assert.fail(error._tag);
              },
              { enableHighAccuracy },
              runtime
            );

          const stopFirst = subscribe(first);
          const stopSecond = subscribe(second);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              stopFirst();
              stopSecond();
            })
          );
          yield* Queue.take(first);
          yield* Queue.take(second);
          assert.strictEqual(native.count(), 1);

          const request = managed.runFork(
            locationLive(requestLocationPermission({ precise: "navigation" }))
          );

          yield* Deferred.await(requested);
          assert.strictEqual(native.count(), 1);
          yield* Deferred.succeed(decision, true);
          yield* Fiber.join(request);

          if (enableHighAccuracy) {
            assert.strictEqual(yield* Queue.take(native.starts), 1);
            assert.strictEqual(yield* Queue.take(native.starts), 2);
            yield* Queue.take(first);
            yield* Queue.take(second);
            assert.strictEqual(native.released(), 1);
          }

          yield* Effect.promise(
            async () =>
              await managed.runPromise(locationLive(checkLocationPermission))
          );
          native.emit({ ...fix, timestamp: 300 });
          assert.strictEqual(yield* Queue.take(first), 300);
          assert.strictEqual(yield* Queue.take(second), 300);
          assert.deepStrictEqual(
            native.calls
              .filter((call) => call.method === "watchPosition")
              .map((call) => call.options.enableHighAccuracy),
            enableHighAccuracy ? [false, true] : [false]
          );
          assert.strictEqual(native.count(), enableHighAccuracy ? 2 : 1);
          stopFirst();
          stopSecond();
          assert.strictEqual(yield* Queue.take(native.releases), 1);

          if (enableHighAccuracy) {
            assert.strictEqual(yield* Queue.take(native.releases), 2);
          }
        })
      )
  );
}

for (const terminal of ["PermissionDenied", "BridgeDecodeError"] as const) {
  it.effect(
    `a shared high-accuracy watch ends on ${terminal} without restarting from the permission refresh`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture();
          native.state.location = "granted";
          native.state.coarseLocation = "granted";
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const fixes = yield* Queue.unbounded<number>();
          const errors = yield* Queue.unbounded<LocationError>();

          const stop = watchPlain(
            (value) => {
              Queue.offerUnsafe(fixes, value.timestamp);
            },
            (error) => {
              Queue.offerUnsafe(errors, error);
            },
            { enableHighAccuracy: true },
            runtime
          );

          yield* Effect.addFinalizer(() => Effect.sync(stop));
          yield* Queue.take(fixes);

          if (terminal === "PermissionDenied") {
            native.fail("OS-PLUG-GLOC-0003");
          } else {
            native.emit({ coords: {}, timestamp: 200 });
          }

          assert.strictEqual((yield* Queue.take(errors))._tag, terminal);
          assert.strictEqual(yield* Queue.take(native.releases), 1);
          assert.strictEqual(native.count(), 1);
        })
      )
  );
}

for (const platform of ["android", "ios"] as const) {
  it.effect(
    `${platform} native timeout recovery backs off to a cap, resets after a fix, and cancels with the last subscriber`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture(platform);
          native.control.watchError = "OS-PLUG-GLOC-0010";
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const errors = yield* Queue.unbounded<LocationError>();
          const fixes = yield* Queue.unbounded<number>();

          const stop = watchPlain(
            (value) => {
              Queue.offerUnsafe(fixes, value.timestamp);
            },
            (error) => {
              Queue.offerUnsafe(errors, error);
            },
            {},
            runtime
          );

          yield* Effect.addFinalizer(() => Effect.sync(stop));
          let attempts = 1;

          for (const delay of [100, 200, 400, 800, 1600, 3200, 5000, 5000]) {
            assert.strictEqual(
              (yield* Queue.take(errors))._tag,
              "LocationTimeout"
            );
            assert.strictEqual(yield* Queue.take(native.releases), attempts);
            assert.strictEqual(native.liveSubscriptions(), 0);
            yield* TestClock.adjust(delay - 1);
            assert.strictEqual(native.count(), attempts);
            yield* TestClock.adjust(1);
            attempts += 1;
            assert.strictEqual(native.count(), attempts);
          }

          yield* Queue.take(errors);
          assert.strictEqual(yield* Queue.take(native.releases), attempts);
          native.control.watchError = "";
          yield* TestClock.adjust(5000);
          attempts += 1;
          assert.strictEqual(yield* Queue.take(fixes), 100);
          native.fail("OS-PLUG-GLOC-0010");
          yield* Queue.take(errors);
          assert.strictEqual(yield* Queue.take(native.releases), attempts);
          yield* TestClock.adjust(99);
          assert.strictEqual(native.count(), attempts);
          yield* TestClock.adjust(1);
          attempts += 1;
          assert.strictEqual(yield* Queue.take(fixes), 100);
          native.fail("OS-PLUG-GLOC-0010");
          yield* Queue.take(errors);
          assert.strictEqual(yield* Queue.take(native.releases), attempts);
          stop();
          yield* TestClock.adjust(60_000);
          assert.strictEqual(native.count(), attempts);
        })
      )
  );

  for (const code of ["OS-PLUG-GLOC-0003", "UNKNOWN"] as const) {
    it.effect(
      `${platform} stops reacquiring when recovery encounters terminal error ${code}`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const native = yield* locationFixture(platform);
            const runtime = createEffectRuntime(native.layer);
            yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
            const errors = yield* Queue.unbounded<LocationError>();
            const fixes = yield* Queue.unbounded<number>();

            const stop = watchPlain(
              (value) => {
                Queue.offerUnsafe(fixes, value.timestamp);
              },
              (error) => {
                Queue.offerUnsafe(errors, error);
              },
              {},
              runtime
            );

            yield* Effect.addFinalizer(() => Effect.sync(stop));
            yield* Queue.take(fixes);
            native.fail("OS-PLUG-GLOC-0010");
            yield* Queue.take(errors);
            yield* Queue.take(native.releases);
            native.control.watchError = code;
            yield* TestClock.adjust(100);
            assert.strictEqual(
              (yield* Queue.take(errors))._tag,
              code === "UNKNOWN" ? "BridgeCallFailed" : "PermissionDenied"
            );
            assert.strictEqual(yield* Queue.take(native.releases), 2);
            yield* TestClock.adjust(60_000);
            assert.strictEqual(native.count(), 2);
            assert.strictEqual(native.liveSubscriptions(), 0);
          })
        )
    );
  }
}

it.effect(
  "iOS timeout invalidates every native callback and each option group reacquires once",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture("ios");
        const runtime = createEffectRuntime(native.layer);
        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const errors = yield* Queue.unbounded<LocationError>();
        const first = yield* Queue.unbounded<number>();
        const second = yield* Queue.unbounded<number>();

        const subscribe = (received: Queue.Queue<number>, timeout: number) =>
          watchPlain(
            (value) => {
              Queue.offerUnsafe(received, value.timestamp);
            },
            (error) => {
              Queue.offerUnsafe(errors, error);
            },
            { timeout },
            runtime
          );

        const stopFirst = subscribe(first, 1000);
        const stopSecond = subscribe(second, 2000);

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            stopFirst();
            stopSecond();
          })
        );
        yield* Queue.take(first);
        yield* Queue.take(second);
        native.control.emitInitialFix = false;
        native.fail("OS-PLUG-GLOC-0010");
        assert.strictEqual(native.liveSubscriptions(), 0);
        yield* Queue.take(errors);
        yield* Queue.take(errors);
        yield* Queue.take(native.releases);
        yield* Queue.take(native.releases);
        native.emit({ ...fix, timestamp: 999 });
        assert.strictEqual(yield* Queue.size(first), 0);
        assert.strictEqual(yield* Queue.size(second), 0);
        yield* TestClock.adjust(100);
        assert.strictEqual(native.count(), 4);
        assert.strictEqual(native.liveSubscriptions(), 2);
        native.emit({ ...fix, timestamp: 300 });
        assert.strictEqual(yield* Queue.take(first), 300);
        assert.strictEqual(yield* Queue.take(second), 300);
      })
    )
);

for (const [code, tag] of [["0002", "Unavailable"]] as const) {
  it.effect(`Android reacquires after native setup failure ${tag}`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture("android");
        native.control.watchError = `OS-PLUG-GLOC-${code}`;
        const runtime = createEffectRuntime(native.layer);
        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const errors = yield* Queue.unbounded<LocationError>();
        const fixes = yield* Queue.unbounded<number>();

        const stop = watchPlain(
          (value) => {
            Queue.offerUnsafe(fixes, value.timestamp);
          },
          (error) => {
            Queue.offerUnsafe(errors, error);
          },
          {},
          runtime
        );

        yield* Effect.addFinalizer(() => Effect.sync(stop));
        assert.strictEqual((yield* Queue.take(errors))._tag, tag);
        assert.strictEqual(yield* Queue.take(native.releases), 1);
        assert.strictEqual(native.liveSubscriptions(), 0);
        native.control.watchError = "";
        yield* TestClock.adjust(100);
        assert.strictEqual(yield* Queue.take(fixes), 100);
        assert.strictEqual(native.count(), 2);
      })
    )
  );
}

for (const code of ["0009", "0007"] as const) {
  it.effect(
    `Android parks a watch after setup failure ${code} until the app returns to the foreground`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture("android");
          // 0009 is the user declining Google's settings dialog; each acquisition would reopen it.
          native.control.watchError = `OS-PLUG-GLOC-${code}`;
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const errors = yield* Queue.unbounded<LocationError>();
          const fixes = yield* Queue.unbounded<number>();

          const stop = watchPlain(
            (value) => {
              Queue.offerUnsafe(fixes, value.timestamp);
            },
            (error) => {
              Queue.offerUnsafe(errors, error);
            },
            {},
            runtime
          );

          yield* Effect.addFinalizer(() => Effect.sync(stop));
          assert.strictEqual(
            (yield* Queue.take(errors))._tag,
            "LocationServicesOff"
          );
          assert.strictEqual(yield* Queue.take(native.releases), 1);
          assert.strictEqual(native.liveSubscriptions(), 0);

          yield* TestClock.adjust(60_000);
          assert.strictEqual(native.count(), 1);
          assert.strictEqual(yield* Queue.size(errors), 0);

          native.control.watchError = "";
          native.active(false);
          // Let the pool observe the background state before the app returns.
          yield* TestClock.adjust(1);
          assert.strictEqual(native.count(), 1);
          native.active(true);
          assert.strictEqual(yield* Queue.take(fixes), 100);
          assert.strictEqual(native.count(), 2);
          assert.strictEqual(native.liveSubscriptions(), 1);

          yield* TestClock.adjust(60_000);
          assert.strictEqual(native.count(), 2);
        })
      )
  );
}
