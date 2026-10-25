import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";

import { openAppSettings } from "../../../src/capabilities/device-info/device-info.ts";
import {
  LocationWatchPoolLive,
  watchLocation,
} from "../../../src/capabilities/location/location-pool.ts";
import {
  BrowserLocation,
  BrowserLocationLive,
  checkLocationPermission,
  decodeLocationFix,
  decodeNativeLocationFix,
  getCurrentLocation,
  normalizeLocationError,
  PermissionDenied,
  openLocationServicesSettings,
  requestLocationPermission,
} from "../../../src/capabilities/location/location.ts";
import {
  Bridge,
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";
import {
  androidFix,
  iosSimulatorFix,
  fix,
  locationFixture,
} from "./fixture.ts";

it.effect(
  "decodes only W3C fields and normalizes missing optional coordinates to null",
  () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decodeLocationFix(fix), {
        latitude: 51,
        longitude: -1,
        accuracy: 12,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: 100,
      });

      for (const invalid of [
        { ...fix, timestamp: -1 },
        { ...fix, coords: { ...fix.coords, latitude: 91 } },
        { ...fix, coords: { ...fix.coords, accuracy: Number.NaN } },
        { ...fix, coords: { ...fix.coords, heading: 360 } },
      ]) {
        assert.strictEqual(
          (yield* Effect.flip(decodeLocationFix(invalid)))._tag,
          "BridgeDecodeError"
        );
      }
    })
);

for (const [code, tag] of [
  ["0007", "LocationServicesOff"],
  ["0009", "LocationServicesOff"],
  ["0003", "PermissionDenied"],
  ["0008", "PermissionDenied"],
  ["0010", "LocationTimeout"],
  ["0004", "BridgeCallFailed"],
  ["9999", "BridgeCallFailed"],
]) {
  it.effect(`normalizes native ${code} to ${tag}`, () =>
    Effect.sync(() => {
      const error = new BridgeCallFailed({
        plugin: "Geolocation",
        method: "getCurrentPosition",
        cause: { code: `OS-PLUG-GLOC-${code}` },
      });

      const normalized = normalizeLocationError(error);
      assert.strictEqual(normalized._tag, tag);

      if (tag === "BridgeCallFailed") {
        assert.strictEqual(normalized, error);
      }
    })
  );
}

it.effect(
  "defaults Android requests to coarse and distinguishes fine grants",
  () =>
    Effect.gen(function* () {
      const native = yield* locationFixture();
      assert.deepStrictEqual(
        yield* checkLocationPermission.pipe(
          Effect.provide(Layer.merge(native.layer, BrowserLocationLive))
        ),
        { state: "prompt", precision: "unknown" }
      );
      assert.deepStrictEqual(
        yield* requestLocationPermission().pipe(
          Effect.provide(Layer.merge(native.layer, BrowserLocationLive))
        ),
        { state: "granted", precision: "approximate" }
      );
      assert.deepStrictEqual(native.calls[1]?.options, {
        permissions: ["coarseLocation"],
      });
      yield* requestLocationPermission({ precise: "navigation" }).pipe(
        Effect.provide(Layer.merge(native.layer, BrowserLocationLive))
      );
      assert.deepStrictEqual(native.calls[2]?.options, {
        permissions: ["location"],
      });
      native.state.location = "granted";
      assert.deepStrictEqual(
        yield* checkLocationPermission.pipe(
          Effect.provide(Layer.merge(native.layer, BrowserLocationLive))
        ),
        { state: "granted", precision: "precise" }
      );
    })
);

it.effect(
  "reads iOS accuracy authorization and passes temporary precision purpose keys",
  () =>
    Effect.gen(function* () {
      const native = yield* locationFixture("ios");
      native.state.location = "granted";
      assert.deepStrictEqual(
        yield* checkLocationPermission.pipe(
          Effect.provide(Layer.merge(native.layer, BrowserLocationLive))
        ),
        { state: "granted", precision: "approximate" }
      );
      native.state.precision = "precise";

      const result = yield* requestLocationPermission({
        precise: "navigation",
      }).pipe(Effect.provide(Layer.merge(native.layer, BrowserLocationLive)));

      assert.strictEqual(result.precision, "precise");
      assert.deepStrictEqual(native.calls.at(-1), {
        method: "requestTemporaryFullAccuracy",
        plugin: "RadicalLocation",
        options: { purposeKey: "navigation" },
      });
    })
);

it.effect("times out a stalled iOS current fix using the Effect clock", () =>
  Effect.gen(function* () {
    const layer = Layer.merge(
      bridgeTestLayer("ios", () => Effect.never),
      BrowserLocationLive
    );

    const fiber = yield* getCurrentLocation({ timeout: 250 }).pipe(
      Effect.flip,
      Effect.provide(layer),
      Effect.forkChild
    );

    yield* TestClock.adjust(250);
    assert.strictEqual((yield* Fiber.join(fiber))._tag, "LocationTimeout");
  })
);

it.effect(
  "shares equivalent watch options, keeps the remaining consumer, pauses and resumes without ending subscriptions",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();

        const pool = LocationWatchPoolLive.pipe(
          Layer.provide(Layer.merge(native.layer, BrowserLocationLive))
        );

        const program = Effect.gen(function* () {
          const firstValue = yield* Deferred.make<boolean>();
          const secondValue = yield* Deferred.make<boolean>();

          const first = yield* watchLocation().pipe(
            Stream.runForEach(() => Deferred.succeed(firstValue, true)),
            Effect.forkChild
          );

          yield* Deferred.await(firstValue);

          const second = yield* watchLocation({
            enableHighAccuracy: false,
            timeout: 10_000,
            maximumAge: 0,
          }).pipe(
            Stream.runForEach(() => Deferred.succeed(secondValue, true)),
            Effect.forkChild
          );

          yield* Deferred.await(secondValue);
          assert.strictEqual(native.count(), 1);
          yield* Fiber.interrupt(first);
          assert.strictEqual(native.released(), 0);
          native.active(false);
          assert.strictEqual(yield* Queue.take(native.releases), 1);
          native.active(true);
          yield* Queue.take(native.starts);
          assert.strictEqual(yield* Queue.take(native.starts), 2);
          yield* Fiber.interrupt(second);
          assert.strictEqual(yield* Queue.take(native.releases), 2);
        });

        yield* program.pipe(Effect.provide(pool));
      })
    )
);

it.effect(
  "a malformed shared fix fails the subscription and releases its watch",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();

        const fiber = yield* watchLocation().pipe(
          Stream.runDrain,
          Effect.flip,
          Effect.provide(
            LocationWatchPoolLive.pipe(
              Layer.provide(Layer.merge(native.layer, BrowserLocationLive))
            )
          ),
          Effect.forkChild
        );

        yield* Queue.take(native.starts);
        native.emit({ timestamp: 1, coords: {} });
        assert.strictEqual(
          (yield* Fiber.join(fiber))._tag,
          "BridgeDecodeError"
        );
        assert.strictEqual(native.released(), 1);
      })
    )
);

it.effect(
  "uses the injectable browser fallback, ignores precise purposes and rejects both settings actions",
  () =>
    Effect.gen(function* () {
      const browser = Layer.succeed(BrowserLocation, {
        current: () => Effect.succeed(fix),
        watch: () => Stream.make(fix),
        check: Effect.succeed({
          state: "granted",
          precision: "unknown",
        } as const),
      });

      const layer = Layer.merge(
        bridgeTestLayer("browser", () => Effect.die("Unexpected native call")),
        browser
      );

      const program = Effect.gen(function* () {
        assert.strictEqual((yield* getCurrentLocation()).latitude, 51);
        assert.deepStrictEqual(
          yield* requestLocationPermission({ precise: "ignored" }),
          { state: "granted", precision: "unknown" }
        );
        assert.strictEqual(
          (yield* Effect.flip(openLocationServicesSettings))._tag,
          "Unavailable"
        );
        assert.strictEqual(
          (yield* Effect.flip(openAppSettings))._tag,
          "Unavailable"
        );
      });

      yield* program.pipe(Effect.provide(layer));
    })
);

it.effect("reports Unavailable when the browser API is absent during SSR", () =>
  Effect.gen(function* () {
    const error = yield* getCurrentLocation().pipe(
      Effect.provide(
        Layer.merge(
          bridgeTestLayer("browser", () => Effect.die("native")),
          BrowserLocationLive
        )
      ),
      Effect.flip
    );

    assert.strictEqual(error._tag, "Unavailable");
  })
);

it.effect(
  "high accuracy hints use an existing precise grant and never upgrade approximate permission",
  () =>
    Effect.gen(function* () {
      const native = yield* locationFixture();
      native.state.coarseLocation = "granted";
      native.state.location = "denied";
      const layer = Layer.merge(native.layer, BrowserLocationLive);
      yield* getCurrentLocation({ enableHighAccuracy: true }).pipe(
        Effect.provide(layer)
      );
      assert.strictEqual(
        native.calls.find((call) => call.method === "getCurrentPosition")
          ?.options.enableHighAccuracy,
        false
      );
      native.state.location = "granted";
      yield* getCurrentLocation({ enableHighAccuracy: true }).pipe(
        Effect.provide(layer)
      );
      assert.strictEqual(native.calls.at(-1)?.options.enableHighAccuracy, true);
      assert.isFalse(
        native.calls.some((call) => call.method === "requestPermissions")
      );
    })
);

for (const platform of ["ios", "android"] as const) {
  it.effect(
    `normalizes real ${platform} payloads for current fixes and watch emissions`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture(platform);
          const layer = Layer.merge(native.layer, BrowserLocationLive);

          const expected = {
            latitude: 51,
            longitude: -1,
            accuracy: 12,
            altitude: platform === "ios" ? null : 0,
            altitudeAccuracy: platform === "ios" ? null : 0,
            speed: platform === "ios" ? null : 0,
            heading: null,
            timestamp: 100,
          };

          assert.deepStrictEqual(
            yield* getCurrentLocation().pipe(Effect.provide(layer)),
            expected
          );
          assert.deepStrictEqual(
            yield* watchLocation().pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.provide(LocationWatchPoolLive.pipe(Layer.provide(layer)))
            ),
            [expected]
          );
          assert.strictEqual(native.released(), 1);
        })
      )
  );
}

it.effect(
  "normalizes negative native sentinels while preserving valid zero measurements and rejecting malformed fields",
  () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decodeNativeLocationFix(iosSimulatorFix), {
        latitude: 51,
        longitude: -1,
        accuracy: 12,
        altitude: null,
        altitudeAccuracy: null,
        speed: null,
        heading: null,
        timestamp: 100,
      });

      const negativeHeading = yield* decodeNativeLocationFix({
        ...iosSimulatorFix,
        coords: { ...iosSimulatorFix.coords, heading: -1 },
      });

      assert.strictEqual(negativeHeading.heading, null);

      const zero = yield* decodeNativeLocationFix({
        ...androidFix,
        coords: { ...androidFix.coords, heading: 0 },
      });

      assert.strictEqual(zero.altitude, 0);
      assert.strictEqual(zero.altitudeAccuracy, 0);
      assert.strictEqual(zero.speed, 0);
      assert.strictEqual(zero.heading, 0);

      for (const coords of [
        { ...iosSimulatorFix.coords, speed: "-1" },
        { ...iosSimulatorFix.coords, altitudeAccuracy: "-1" },
        { ...iosSimulatorFix.coords, speed: Number.NaN },
        { ...iosSimulatorFix.coords, accuracy: -1 },
      ]) {
        assert.strictEqual(
          (yield* decodeNativeLocationFix({ ...iosSimulatorFix, coords }).pipe(
            Effect.flip
          ))._tag,
          "BridgeDecodeError"
        );
      }

      assert.strictEqual(
        (yield* decodeLocationFix(iosSimulatorFix).pipe(Effect.flip))._tag,
        "BridgeDecodeError"
      );
    })
);

it.effect(
  "permission requests resolve denied on web while fix and watch operations still fail PermissionDenied",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const browser = Layer.succeed(BrowserLocation, {
          current: () => Effect.fail(new PermissionDenied({})),
          watch: () => Stream.fail(new PermissionDenied({})),
          check: Effect.succeed({
            state: "denied",
            precision: "unknown",
          } as const),
        });

        const layer = Layer.merge(
          bridgeTestLayer("browser", () =>
            Effect.die("Unexpected native call")
          ),
          browser
        );

        const expected = { state: "denied", precision: "unknown" } as const;
        assert.deepStrictEqual(
          yield* requestLocationPermission().pipe(Effect.provide(layer)),
          expected
        );
        assert.deepStrictEqual(
          yield* checkLocationPermission.pipe(Effect.provide(layer)),
          expected
        );
        assert.strictEqual(
          (yield* getCurrentLocation().pipe(Effect.provide(layer), Effect.flip))
            ._tag,
          "PermissionDenied"
        );
        assert.strictEqual(
          (yield* watchLocation().pipe(
            Stream.runDrain,
            Effect.provide(LocationWatchPoolLive.pipe(Layer.provide(layer))),
            Effect.flip
          ))._tag,
          "PermissionDenied"
        );
      })
    )
);

for (const code of ["OS-PLUG-GLOC-0003", "OS-PLUG-GLOC-0008"]) {
  it.effect(
    `native permission check and request normalize ${code} to a denied value`,
    () =>
      Effect.gen(function* () {
        const layer = Layer.merge(
          bridgeTestLayer("ios", (_plugin, method) =>
            Effect.fail(
              new BridgeCallFailed({
                plugin: "Geolocation",
                method,
                cause: { code },
              })
            )
          ),
          BrowserLocationLive
        );

        assert.deepStrictEqual(
          yield* checkLocationPermission.pipe(Effect.provide(layer)),
          { state: "denied", precision: "unknown" }
        );
        assert.deepStrictEqual(
          yield* requestLocationPermission().pipe(Effect.provide(layer)),
          { state: "denied", precision: "unknown" }
        );
        assert.strictEqual(
          (yield* getCurrentLocation().pipe(Effect.provide(layer), Effect.flip))
            ._tag,
          "PermissionDenied"
        );
      })
  );
}

it.effect(
  "Android coarse current requests select the Google fresh path without a recovery watch",
  () =>
    Effect.gen(function* () {
      const now = 1_792_911_569_000;
      yield* TestClock.setTime(now);
      const native = yield* locationFixture();
      const original = yield* Bridge.pipe(Effect.provide(native.layer));

      const layer = Layer.merge(
        BrowserLocationLive,
        Layer.succeed(Bridge, {
          ...original,
          call: (plugin, method, options) => {
            if (method !== "getCurrentPosition") {
              return original.call(plugin, method, options);
            }

            assert.strictEqual(options.maximumAge, 0);
            assert.strictEqual(options.enableHighAccuracy, false);

            // Model ION 2.2.2's fallback listener accepting Android's historical coarse callback.
            const timestamp =
              options.enableLocationFallback === false
                ? now
                : 1_792_685_419_719;

            return Effect.succeed({ ...androidFix, timestamp });
          },
        })
      );

      assert.strictEqual(
        (yield* getCurrentLocation().pipe(Effect.provide(layer))).timestamp,
        now
      );
      assert.strictEqual(native.count(), 0);
    })
);

it.effect(
  "Android watches disable LocationManager fallback and forward the requested timing options",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        yield* watchLocation({ maximumAge: 1500, timeout: 25_000 }).pipe(
          Stream.take(1),
          Stream.runDrain,
          Effect.provide(
            LocationWatchPoolLive.pipe(
              Layer.provide(Layer.merge(native.layer, BrowserLocationLive))
            )
          )
        );
        assert.deepStrictEqual(
          native.calls.find((call) => call.method === "watchPosition")?.options,
          {
            enableHighAccuracy: false,
            maximumAge: 1500,
            timeout: 25_000,
            enableLocationFallback: false,
          }
        );
        assert.strictEqual(native.released(), 1);
      })
    )
);

it.effect(
  "maximumAge permits an explicitly accepted cached fix without starting a watch",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(10_000);
      const native = yield* locationFixture();
      native.control.timestamp = 7000;
      assert.strictEqual(
        (yield* getCurrentLocation({ maximumAge: 3000 }).pipe(
          Effect.provide(Layer.merge(native.layer, BrowserLocationLive))
        )).timestamp,
        7000
      );
      assert.strictEqual(
        native.calls.find((call) => call.method === "getCurrentPosition")
          ?.options.maximumAge,
        3000
      );
      assert.strictEqual(native.count(), 0);
    })
);

for (const apiLevel of [24, 30]) {
  it.effect(
    `Android API ${apiLevel} reports precise after the platform grants FINE in the allowed permission group`,
    () =>
      Effect.gen(function* () {
        const native = yield* locationFixture();
        native.control.androidApiLevel = apiLevel;
        const layer = Layer.merge(native.layer, BrowserLocationLive);
        assert.deepStrictEqual(
          yield* requestLocationPermission().pipe(Effect.provide(layer)),
          { state: "granted", precision: "approximate" }
        );
        yield* getCurrentLocation().pipe(Effect.provide(layer));
        assert.strictEqual(native.state.location, "granted");
        assert.deepStrictEqual(
          yield* checkLocationPermission.pipe(Effect.provide(layer)),
          { state: "granted", precision: "precise" }
        );
        assert.deepStrictEqual(
          yield* requestLocationPermission().pipe(Effect.provide(layer)),
          { state: "granted", precision: "precise" }
        );
        assert.deepStrictEqual(
          native.calls
            .filter((call) => call.method === "requestPermissions")
            .map((call) => call.options.permissions),
          [["coarseLocation"], ["coarseLocation"]]
        );
      })
  );
}

for (const decision of ["accept", "decline"] as const) {
  it.effect(
    `Android settings resolution can ${decision} after the acquisition timeout without expiring the call`,
    () =>
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const original = yield* Bridge.pipe(Effect.provide(native.layer));
        const opened = yield* Deferred.make<boolean>();
        const decisionReady = yield* Deferred.make<boolean>();

        const layer = Layer.merge(
          BrowserLocationLive,
          Layer.succeed(Bridge, {
            ...original,
            call: (plugin, method, options) =>
              method === "getCurrentPosition"
                ? Effect.gen(function* () {
                    assert.strictEqual(options.timeout, 250);
                    assert.strictEqual(options.enableLocationFallback, false);
                    yield* Deferred.succeed(opened, true);
                    // Model ION awaiting the native activity result before starting acquisition.
                    yield* Deferred.await(decisionReady);

                    if (decision === "decline") {
                      return yield* new BridgeCallFailed({
                        plugin,
                        method,
                        cause: { code: "OS-PLUG-GLOC-0009" },
                      });
                    }

                    return yield* original.call(plugin, method, options);
                  })
                : original.call(plugin, method, options),
          })
        );

        const fiber = yield* getCurrentLocation({ timeout: 250 }).pipe(
          Effect.result,
          Effect.provide(layer),
          Effect.forkChild
        );

        yield* Deferred.await(opened);
        yield* TestClock.adjust(30_000);
        yield* Deferred.succeed(decisionReady, true);
        const result = yield* Fiber.join(fiber);

        if (decision === "accept") {
          assert.strictEqual(result._tag, "Success");

          if (result._tag === "Success") {
            assert.strictEqual(result.success.latitude, 51);
          }
        } else {
          assert.strictEqual(result._tag, "Failure");

          if (result._tag === "Failure") {
            assert.strictEqual(result.failure._tag, "LocationServicesOff");
          }
        }

        assert.strictEqual(native.count(), 0);
      })
  );
}

it.effect(
  "non-GMS current and watch requests enable LocationManager and deliver its historical first fix",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        native.control.playServicesAvailable = false;
        native.control.timestamp = 1_792_685_419_719;
        yield* TestClock.setTime(1_792_911_569_000);
        const layer = Layer.merge(native.layer, BrowserLocationLive);
        assert.strictEqual(
          (yield* getCurrentLocation().pipe(Effect.provide(layer))).timestamp,
          native.control.timestamp
        );
        // Current requests do not start a recovery watch, even with maximumAge zero.
        assert.strictEqual(native.count(), 0);

        const watched = yield* watchLocation({}).pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.provide(LocationWatchPoolLive.pipe(Layer.provide(layer)))
        );

        assert.strictEqual(watched[0]?.timestamp, native.control.timestamp);

        for (const method of ["getCurrentPosition", "watchPosition"]) {
          const options = native.calls.find(
            (call) => call.method === method
          )?.options;

          assert.strictEqual(options?.enableLocationFallback, true);
          assert.strictEqual(options?.maximumAge, 0);
        }

        assert.strictEqual(native.count(), 1);
        assert.strictEqual(native.released(), 1);
      })
    )
);

for (const platform of ["android", "ios"] as const) {
  it.effect(
    `${platform} permission checks and requests resolve with services off while fixes and watches fail with LocationServicesOff`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture(platform);
          native.control.servicesEnabled = false;
          const layer = Layer.merge(native.layer, BrowserLocationLive);

          for (const [coarse, fine, precision, state] of [
            ["prompt", "prompt", "unknown", "prompt"],
            [
              "prompt-with-rationale",
              "prompt-with-rationale",
              "unknown",
              "prompt",
            ],
            ["denied", "denied", "unknown", "denied"],
            ["granted", "denied", "approximate", "granted"],
            ["granted", "granted", "precise", "granted"],
          ] as const) {
            native.state.coarseLocation = coarse;
            native.state.location = fine;
            native.state.precision = precision;
            assert.deepStrictEqual(
              yield* checkLocationPermission.pipe(Effect.provide(layer)),
              platform === "ios"
                ? { state: "denied", precision: "unknown" }
                : { state, precision }
            );
          }

          native.state.location = "prompt";
          native.state.coarseLocation = "prompt";
          assert.deepStrictEqual(
            yield* requestLocationPermission().pipe(Effect.provide(layer)),
            platform === "ios"
              ? { state: "denied", precision: "unknown" }
              : { state: "granted", precision: "approximate" }
          );
          assert.deepStrictEqual(
            yield* requestLocationPermission({ precise: "navigation" }).pipe(
              Effect.provide(layer)
            ),
            platform === "ios"
              ? { state: "denied", precision: "unknown" }
              : { state: "granted", precision: "precise" }
          );
          native.control.requestGranted = false;
          assert.deepStrictEqual(
            yield* requestLocationPermission().pipe(Effect.provide(layer)),
            { state: "denied", precision: "unknown" }
          );

          for (const call of native.calls.filter((entry) =>
            ["checkPermissions", "requestPermissions"].includes(entry.method)
          )) {
            assert.strictEqual(call.plugin, "RadicalLocation");
          }

          assert.strictEqual(
            (yield* getCurrentLocation().pipe(
              Effect.provide(layer),
              Effect.flip
            ))._tag,
            "LocationServicesOff"
          );
          assert.strictEqual(
            (yield* watchLocation().pipe(
              Stream.runDrain,
              Effect.provide(LocationWatchPoolLive.pipe(Layer.provide(layer))),
              Effect.flip
            ))._tag,
            "LocationServicesOff"
          );
          assert.strictEqual(native.released(), 1);
        })
      )
  );
}
