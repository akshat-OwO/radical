import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";

import { browserLocationLayer } from "../../../src/capabilities/location/browser-location.ts";
import {
  LocationWatchPoolLive,
  watchLocation,
} from "../../../src/capabilities/location/location-pool.ts";
import { getCurrentLocation } from "../../../src/capabilities/location/location.ts";
import { browserPosition } from "../../../src/capabilities/location/navigator-location.ts";
import { bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";

const position = browserPosition({
  latitude: 1,
  longitude: 2,
  accuracy: 3,
  altitude: null,
  altitudeAccuracy: null,
  heading: null,
  speed: null,
  timestamp: 4,
});

for (const [code, tag] of [
  [1, "PermissionDenied"],
  [2, "Unavailable"],
  [3, "LocationTimeout"],
] as const) {
  it.effect(`browser error ${code} becomes ${tag}`, () =>
    Effect.gen(function* () {
      const geo: Geolocation = {
        getCurrentPosition: (_success, error) => {
          error?.({
            code,
            message: "failure",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        },
        watchPosition: () => assert.fail("Unexpected watch"),
        clearWatch: () => {
          assert.fail("Unexpected clear");
        },
      };

      const layer = Layer.merge(
        bridgeTestLayer("browser", () => Effect.die("Unexpected native call")),
        browserLocationLayer(() => ({ geolocation: geo }))
      );

      assert.strictEqual(
        (yield* getCurrentLocation().pipe(Effect.provide(layer), Effect.flip))
          ._tag,
        tag
      );
    })
  );
}

it.effect(
  "browser watches release on interruption and ignore late callbacks",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const acquired = yield* Deferred.make<boolean>();
        const received = yield* Queue.unbounded<number>();
        let emit: PositionCallback | undefined;
        let released = 0;

        const geo: Geolocation = {
          getCurrentPosition: (receive) => {
            receive(position);
          },
          watchPosition: (receive) => {
            emit = receive;
            Effect.runSync(Deferred.succeed(acquired, true));

            return 7;
          },
          clearWatch: (id) => {
            assert.strictEqual(id, 7);
            released += 1;
          },
        };

        const layer = Layer.merge(
          bridgeTestLayer("browser", () =>
            Effect.die("Unexpected native call")
          ),
          browserLocationLayer(() => ({ geolocation: geo }))
        );

        const fiber = yield* watchLocation().pipe(
          Stream.runForEach((fix) => Queue.offer(received, fix.latitude)),
          Effect.provide(LocationWatchPoolLive.pipe(Layer.provide(layer))),
          Effect.forkChild
        );

        yield* Deferred.await(acquired);
        emit?.(position);
        assert.strictEqual(yield* Queue.take(received), 1);
        yield* Fiber.interrupt(fiber);
        assert.strictEqual(released, 1);
        emit?.(position);
        assert.strictEqual(yield* Queue.size(received), 0);
      })
    )
);
