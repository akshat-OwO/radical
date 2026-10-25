import { Context, Effect, Layer, Stream, Queue } from "effect";

import {
  PermissionDenied,
  Unavailable,
  LocationTimeout,
} from "./location-schema.ts";
import type { LocationOptions, LocationPermission } from "./location-schema.ts";

export type BrowserLocationError =
  | PermissionDenied
  | Unavailable
  | LocationTimeout;

export const browserLocationError = (
  error: GeolocationPositionError
): BrowserLocationError => {
  if (error.code === 1) {
    return new PermissionDenied({});
  }

  return error.code === 3
    ? new LocationTimeout({})
    : new Unavailable({ reason: error.message });
};

export class BrowserLocation extends Context.Service<
  BrowserLocation,
  {
    readonly current: (
      options: LocationOptions
    ) => Effect.Effect<unknown, BrowserLocationError>;
    readonly watch: (
      options: LocationOptions
    ) => Stream.Stream<unknown, BrowserLocationError>;
    readonly check: Effect.Effect<LocationPermission, Unavailable>;
  }
>()("radical/BrowserLocation") {}

export interface LocationEnvironment {
  readonly geolocation?: Geolocation;
  readonly permissions?: Pick<Permissions, "query">;
}

const unavailable = () =>
  new Unavailable({ reason: "Location requires a browser geolocation API" });

export const browserLocationLayer = (read: () => LocationEnvironment) =>
  Layer.succeed(BrowserLocation, {
    current: (options) =>
      Effect.suspend(() => {
        const geo = read().geolocation;

        return geo
          ? Effect.callback<unknown, BrowserLocationError>((resume) => {
              geo.getCurrentPosition(
                (fix) => {
                  resume(Effect.succeed(fix));
                },
                (error) => {
                  resume(Effect.fail(browserLocationError(error)));
                },
                options
              );
            })
          : Effect.fail(unavailable());
      }),
    watch: (options) =>
      Stream.callback<
        Effect.Effect<unknown, BrowserLocationError>,
        BrowserLocationError
      >(
        (queue) =>
          Effect.gen(function* () {
            const geo = read().geolocation;

            if (!geo) {
              return yield* unavailable();
            }

            yield* Effect.acquireRelease(
              Effect.sync(() =>
                geo.watchPosition(
                  (fix) => {
                    Queue.offerUnsafe(queue, Effect.succeed(fix));
                  },
                  (error) => {
                    Queue.offerUnsafe(
                      queue,
                      Effect.fail(browserLocationError(error))
                    );
                  },
                  options
                )
              ),
              (id) =>
                Effect.sync(() => {
                  geo.clearWatch(id);
                })
            );

            return yield* Effect.void;
          }),
        { bufferSize: 1, strategy: "sliding" }
      ).pipe(Stream.mapEffect((result) => result)),
    check: Effect.suspend(() => {
      const { permissions } = read();

      return permissions
        ? Effect.tryPromise({
            try: () => permissions.query({ name: "geolocation" }),
            catch: () => unavailable(),
          }).pipe(
            Effect.map((status): LocationPermission => ({
              state: status.state,
              precision: "unknown",
            }))
          )
        : Effect.succeed<LocationPermission>({
            state: "prompt",
            precision: "unknown",
          });
    }),
  });

export const BrowserLocationLive = browserLocationLayer(() =>
  typeof navigator === "undefined" ? {} : navigator
);
