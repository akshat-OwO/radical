import { Effect, Layer, Queue, RcRef, Schema, Stream } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import { BrowserLocationLive } from "./browser-location.ts";
import { LocationPermissionEvents } from "./location-permission-events.ts";
import type { LocationPermission } from "./location-schema.ts";
import { checkLocationPermission } from "./location.ts";

/** Share foreground refreshes for the lifetime of permission subscribers. */
export const LocationPermissionEventsLive = Layer.effect(
  LocationPermissionEvents,
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    let latest: LocationPermission | undefined;
    let revision = 0;
    const listeners = new Set<(permission: LocationPermission) => void>();

    const publish = (
      permission: LocationPermission,
      expectedRevision?: number
    ) => {
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        return;
      }

      revision += 1;

      if (
        latest?.state === permission.state &&
        latest.precision === permission.precision
      ) {
        return;
      }

      latest = permission;

      for (const receive of listeners) {
        receive(permission);
      }
    };

    const activity = yield* RcRef.make({
      acquire: Effect.gen(function* () {
        if ((yield* bridge.runtime) === "browser" || !bridge.listen) {
          return;
        }

        const resumes = yield* Queue.unbounded<boolean>();
        const state = Schema.is(Schema.Struct({ active: Schema.Boolean }));
        yield* Stream.fromQueue(resumes).pipe(
          Stream.runForEach(() =>
            Effect.suspend(() => {
              const expectedRevision = revision;

              return checkLocationPermission.pipe(
                Effect.provide(BrowserLocationLive),
                Effect.tap((permission) =>
                  Effect.sync(() => {
                    publish(permission, expectedRevision);
                  })
                ),
                Effect.ignore
              );
            })
          ),
          Effect.forkScoped
        );
        yield* Effect.acquireRelease(
          bridge.listen("RadicalLocation", "appStateChange", (value) => {
            if (state(value) && value.active) {
              Queue.offerUnsafe(resumes, true);
            }
          }),
          (release) => release
        ).pipe(Effect.ignore);
      }),
    });

    return {
      revision: () => revision,
      publish,
      listen: (receive) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              listeners.add(receive);

              if (latest !== undefined) {
                receive(latest);
              }
            }),
            () =>
              Effect.sync(() => {
                listeners.delete(receive);
              })
          );
          yield* RcRef.get(activity);
        }),
    };
  })
);
