// oxlint-disable eslint/max-classes-per-file -- The structural watch key is private to the pool service.
import {
  Context,
  Data,
  Effect,
  Layer,
  Queue,
  RcMap,
  Schema,
  Stream,
} from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import type { BrowserLocation } from "./browser-location.ts";
import { BrowserLocationLive } from "./browser-location.ts";
import type { LocationFix, LocationOptions } from "./location-schema.ts";
import { rawLocationWatch, locationOptions } from "./location.ts";
import type { LocationError } from "./location.ts";

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

export class LocationWatchPool extends Context.Service<
  LocationWatchPool,
  {
    readonly watch: (
      options: LocationOptions
    ) => Stream.Stream<LocationFix, LocationError>;
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
            Stream.switchMap((active) =>
              active ? rawLocationWatch(options) : Stream.never
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

export const watchLocation = (
  options: LocationOptions = {}
): Stream.Stream<LocationFix, LocationError, LocationWatchPool> =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* LocationWatchPool).watch(options);
    })
  );

export const locationLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserLocation>
) => effect.pipe(Effect.provide(BrowserLocationLive));
