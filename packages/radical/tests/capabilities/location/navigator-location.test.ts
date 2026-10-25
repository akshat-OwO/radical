import { assert, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";

import {
  locationLive,
  watchLocation,
} from "../../../src/capabilities/location/location-pool.ts";
import {
  LocationServicesOff,
  LocationTimeout,
  PermissionDenied,
  checkLocationPermission,
} from "../../../src/capabilities/location/location.ts";
import {
  installNavigatorLocation,
  positionError,
} from "../../../src/capabilities/location/navigator-location.ts";
import {
  createEffectRuntime,
  getEffectRuntime,
} from "../../../src/plain/runtime.ts";
import { locationFixture } from "./fixture.ts";

const navigatorFixture = () => {
  const status: PermissionStatus = Object.assign(new EventTarget(), {
    state: "prompt" as const,
    name: "notifications",
    onchange: null,
  });

  const geolocation: Geolocation = {
    getCurrentPosition: () => {
      assert.fail("Unexpected browser geolocation call");
    },
    watchPosition: () => assert.fail("Unexpected browser geolocation watch"),
    clearWatch: () => {
      assert.fail("Unexpected browser geolocation release");
    },
  };

  const query: Permissions["query"] = async () =>
    await Effect.runPromise(Effect.succeed(status));

  return {
    target: { geolocation, permissions: { query } },
    status,
    geolocation,
    query,
  };
};

it.effect(
  "shell navigator calls prompt once with coarse precision, share API watches, update permissions and restore on release",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const clock = yield* Clock.Clock;

        const runtime = createEffectRuntime(
          Layer.merge(native.layer, Layer.succeed(Clock.Clock, clock))
        );

        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const fake = navigatorFixture();
        const restore = yield* installNavigatorLocation(fake.target, runtime);
        yield* Effect.addFinalizer(() => restore);

        const status = yield* Effect.promise(
          async () =>
            await fake.target.permissions.query({ name: "geolocation" })
        );

        assert.strictEqual(status.state, "prompt");
        let changes = 0;
        // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Verify the standard PermissionStatus onchange property.
        status.onchange = () => {
          changes += 1;
        };

        const firstValue = yield* Deferred.make<GeolocationPosition>();
        const secondValue = yield* Deferred.make<GeolocationPosition>();

        const first = fake.target.geolocation.watchPosition((position) => {
          Effect.runSync(Deferred.succeed(firstValue, position));
        });

        assert.strictEqual(
          (yield* Deferred.await(firstValue)).coords.latitude,
          51
        );
        assert.strictEqual(status.state, "granted");

        const second = fake.target.geolocation.watchPosition((position) => {
          Effect.runSync(Deferred.succeed(secondValue, position));
        });

        yield* Deferred.await(secondValue);
        const apiValue = yield* Deferred.make<boolean>();

        const apiWatch = getEffectRuntime(runtime).runFork(
          watchLocation().pipe(
            Stream.runForEach(() => Deferred.succeed(apiValue, true))
          )
        );

        yield* Deferred.await(apiValue);
        assert.strictEqual(native.count(), 1);
        assert.strictEqual(
          native.calls.filter((call) => call.method === "requestPermissions")
            .length,
          1
        );
        assert.deepStrictEqual(
          native.calls.find((call) => call.method === "requestPermissions")
            ?.options,
          { permissions: ["coarseLocation"] }
        );
        native.state.location = "denied";
        native.state.coarseLocation = "denied";
        yield* Effect.promise(
          async () =>
            await getEffectRuntime(runtime).runPromise(
              locationLive(checkLocationPermission)
            )
        );
        assert.strictEqual(status.state, "denied");
        assert.strictEqual(changes, 2);
        fake.target.geolocation.clearWatch(first);
        fake.target.geolocation.clearWatch(second);
        yield* Fiber.interrupt(apiWatch);
        assert.strictEqual(yield* Queue.take(native.releases), 1);
        yield* restore;
        assert.strictEqual(fake.target.geolocation, fake.geolocation);
        // oxlint-disable-next-line typescript/unbound-method -- Verify restoration of the exact original method.
        assert.strictEqual(fake.target.permissions.query, fake.query);
        assert.strictEqual(
          yield* Effect.promise(
            async () =>
              await fake.target.permissions.query({ name: "notifications" })
          ),
          fake.status
        );
      })
    )
);

it.effect(
  "native getCurrentPosition returns a W3C position through the replacement",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const clock = yield* Clock.Clock;

        const runtime = createEffectRuntime(
          Layer.merge(native.layer, Layer.succeed(Clock.Clock, clock))
        );

        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const fake = navigatorFixture();
        yield* Effect.acquireRelease(
          installNavigatorLocation(fake.target, runtime),
          (release) => release
        ).pipe(Effect.asVoid);
        const result = yield* Deferred.make<GeolocationPosition>();
        fake.target.geolocation.getCurrentPosition(
          (position) => {
            Effect.runSync(Deferred.succeed(result, position));
          },
          () => {
            assert.fail("Unexpected location error");
          },
          { enableHighAccuracy: true }
        );
        const position = yield* Deferred.await(result);
        assert.strictEqual(position.coords.altitude, 0);
        assert.strictEqual(position.timestamp, 100);
        assert.isObject(position.toJSON());
        assert.strictEqual(
          native.calls.find((call) => call.method === "getCurrentPosition")
            ?.options.enableHighAccuracy,
          false
        );
        assert.deepStrictEqual(
          native.calls.find((call) => call.method === "requestPermissions")
            ?.options,
          { permissions: ["coarseLocation"] }
        );
      })
    )
);

it.effect("maps native failures to the standard navigator error codes", () =>
  Effect.sync(() => {
    assert.strictEqual(positionError(new PermissionDenied({})).code, 1);
    assert.strictEqual(positionError(new LocationServicesOff({})).code, 2);
    assert.strictEqual(positionError(new LocationTimeout({})).code, 3);
  })
);

it.effect(
  "a denied first navigator request reports PERMISSION_DENIED without prompting a second time",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        native.control.requestGranted = false;
        const runtime = createEffectRuntime(native.layer);
        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const fake = navigatorFixture();
        yield* Effect.acquireRelease(
          installNavigatorLocation(fake.target, runtime),
          (release) => release
        ).pipe(Effect.asVoid);
        const error = yield* Deferred.make<GeolocationPositionError>();
        fake.target.geolocation.watchPosition(
          () => {
            assert.fail("Denied watch produced a fix");
          },
          (failure) => {
            Effect.runSync(Deferred.succeed(error, failure));
          }
        );
        assert.strictEqual((yield* Deferred.await(error)).code, 1);
        assert.strictEqual(
          native.calls.filter((call) => call.method === "requestPermissions")
            .length,
          1
        );
        assert.strictEqual(native.count(), 0);
      })
    )
);

it.effect(
  "installing the navigator replacement observes resumes only after a permission status is queried",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const runtime = createEffectRuntime(native.layer);
        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const fake = navigatorFixture();
        const restore = yield* installNavigatorLocation(fake.target, runtime);
        yield* Effect.addFinalizer(() => restore);
        native.active(true);
        assert.strictEqual(native.activityListeners(), 0);
        assert.strictEqual(native.calls.length, 0);

        const status = yield* Effect.promise(
          async () =>
            await fake.target.permissions.query({ name: "geolocation" })
        );

        assert.strictEqual(yield* Queue.take(native.activityStarts), 1);

        const changed = yield* Deferred.make<boolean>();
        status.addEventListener("change", () => {
          Effect.runSync(Deferred.succeed(changed, true));
        });
        native.state.coarseLocation = "granted";
        native.active(true);
        yield* Deferred.await(changed);
        assert.strictEqual(status.state, "granted");
        assert.strictEqual(
          native.calls.filter((call) => call.method === "checkPermissions")
            .length,
          2
        );
        yield* restore;
        assert.strictEqual(yield* Queue.take(native.activityReleases), 1);
        assert.strictEqual(native.activityListeners(), 0);
      })
    )
);

for (const platform of ["android", "ios"] as const) {
  it.effect(
    `${platform} navigator permission queries resolve with services off and refresh when services return`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture(platform);
          native.control.servicesEnabled = false;
          native.state.coarseLocation = "granted";
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));

          const fake = navigatorFixture();
          const restore = yield* installNavigatorLocation(fake.target, runtime);
          yield* Effect.addFinalizer(() => restore);

          const status = yield* Effect.promise(
            async () =>
              await fake.target.permissions.query({ name: "geolocation" })
          );

          assert.strictEqual(
            status.state,
            platform === "ios" ? "denied" : "granted"
          );
          const changed = yield* Deferred.make<boolean>();
          status.addEventListener("change", () => {
            Effect.runSync(Deferred.succeed(changed, true));
          });
          native.control.servicesEnabled = true;
          native.state.location = "denied";
          native.state.coarseLocation =
            platform === "ios" ? "granted" : "denied";
          native.active(true);
          yield* Deferred.await(changed);
          assert.strictEqual(
            status.state,
            platform === "ios" ? "granted" : "denied"
          );
          assert.isTrue(
            native.calls
              .filter((call) => call.method === "checkPermissions")
              .every((call) => call.plugin === "RadicalLocation")
          );
        })
      )
  );
}
