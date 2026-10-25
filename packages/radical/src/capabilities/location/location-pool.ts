// oxlint-disable eslint/max-classes-per-file -- The structural watch key is private to the pool service.
import {
  Context,
  Duration,
  Result,
  Schedule,
  Data,
  Effect,
  Layer,
  Queue,
  Option,
  RcMap,
  Schema,
  Stream,
} from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import type { BrowserLocation } from "./browser-location.ts";
import { BrowserLocationLive } from "./browser-location.ts";
import { LocationPermissionEvents } from "./location-permission-events.ts";
import type { LocationFix, LocationOptions } from "./location-schema.ts";
import {
  rawLocationWatch,
  locationOptions,
  checkLocationPermission,
} from "./location.ts";
import type { LocationWatchEvent, LocationError } from "./location.ts";

class WatchOptions extends Data.Class<Required<LocationOptions>> {}

/** One lifecycle listener per pool; changing activity interrupts only the native watch. */
const appActivity = Stream.callback<boolean, BridgeError, Bridge>(
  (queue) =>
    Effect.gen(function* () {
      const bridge = yield* Bridge;

      if ((yield* bridge.runtime) === "browser" || !bridge.listen) {
        Queue.offerUnsafe(queue, true);

        return;
      }

      let changed = false;
      const state = Schema.is(Schema.Struct({ active: Schema.Boolean }));
      yield* Effect.acquireRelease(
        bridge.listen("RadicalLocation", "appStateChange", (value) => {
          if (state(value)) {
            changed = true;
            Queue.offerUnsafe(queue, value.active);
          }
        }),
        (release) => release
      ).pipe(Effect.asVoid);

      if (!changed) {
        Queue.offerUnsafe(queue, true);
      }
    }),
  { bufferSize: 1, strategy: "sliding" }
).pipe(Stream.changes);

/** Only effective accuracy changes invalidate an acquisition, not every permission publication. */
const watchAccuracy = (requested: boolean) =>
  Stream.callback<boolean, LocationError, Bridge | BrowserLocation>(
    (queue) =>
      Effect.gen(function* () {
        const bridge = yield* Bridge;
        const events = yield* Effect.serviceOption(LocationPermissionEvents);

        if (
          !requested ||
          (yield* bridge.runtime) === "browser" ||
          Option.isNone(events)
        ) {
          Queue.offerUnsafe(queue, requested);

          return;
        }

        const initial = yield* checkLocationPermission;
        Queue.offerUnsafe(queue, initial.precision === "precise");
        yield* events.value.listen((permission) => {
          // Denial is delivered by acquisition as a terminal error. It must not
          // switch away from that error into another acquisition.
          if (permission.state === "granted") {
            Queue.offerUnsafe(queue, permission.precision === "precise");
          }
        });
      }),
    { bufferSize: 1, strategy: "sliding" }
  ).pipe(Stream.changes);

/** Native timeouts end acquisition on both pinned plugins; the browser retains its watch. */
const resilientLocationWatch = (options: LocationOptions) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const runtime = yield* (yield* Bridge).runtime;

      if (runtime === "browser") {
        return rawLocationWatch(options);
      }

      let failures = 0;

      const backoff = Schedule.spaced("100 millis").pipe(
        Schedule.modifyDelay(() =>
          Effect.sync(() => {
            const delay = Math.min(100 * 2 ** failures, 5000);
            failures = Math.min(failures + 1, 6);

            return Duration.millis(delay);
          })
        )
      );

      return Stream.suspend(() => {
        let hasFix = false;

        return rawLocationWatch(options).pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              if (Result.isSuccess(event)) {
                hasFix = true;
                failures = 0;
              }
            })
          ),
          Stream.takeUntil(
            (event) =>
              Result.isFailure(event) &&
              (event.failure._tag === "LocationTimeout" ||
                // Android setup errors can finish without installing a location handler.
                (runtime === "android" && !hasFix))
          ),
          // Close the dead native callback before sleeping or acquiring its replacement.
          Stream.scoped
        );
      }).pipe(Stream.repeat(backoff));
    })
  );

export class LocationWatchPool extends Context.Service<
  LocationWatchPool,
  {
    readonly watch: (
      options: LocationOptions
    ) => Stream.Stream<LocationWatchEvent, LocationError>;
  }
>()("radical/LocationWatchPool") {}

export const LocationWatchPoolLive = Layer.effect(
  LocationWatchPool,
  Effect.gen(function* () {
    const activity = yield* Stream.share(appActivity, {
      capacity: 1,
      strategy: "sliding",
      replay: 1,
    });

    const watches = yield* RcMap.make({
      lookup: (options: Required<LocationOptions>) =>
        Stream.share(
          activity.pipe(
            Stream.zipLatest(watchAccuracy(options.enableHighAccuracy)),
            Stream.switchMap(([active, enableHighAccuracy]) =>
              active
                ? resilientLocationWatch({ ...options, enableHighAccuracy })
                : Stream.never
            )
          ),
          { capacity: 1, strategy: "sliding", replay: 1 }
        ),
    });

    return {
      watch: (options) =>
        Stream.unwrap(
          RcMap.get(watches, new WatchOptions(locationOptions(options)))
        ),
    };
  })
);

/** Internal callback feed: transient acquisition errors remain in-band; terminal errors fail. */
export const watchLocationEvents = (
  options: LocationOptions = {}
): Stream.Stream<LocationWatchEvent, LocationError, LocationWatchPool> =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* LocationWatchPool).watch(options);
    })
  );

/** A stream of fixes with errors in Effect's error channel. Use Stream.retry to reacquire after an error. */
export const watchLocation = (
  options: LocationOptions = {}
): Stream.Stream<LocationFix, LocationError, LocationWatchPool> =>
  watchLocationEvents(options).pipe(Stream.mapEffect(Effect.fromResult));

export const locationLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserLocation>
) => effect.pipe(Effect.provide(BrowserLocationLive));
