import { Context, Effect, Option } from "effect";
import type { Scope } from "effect";

import type { LocationPermission } from "./location-schema.ts";

/** PermissionStatus objects are runtime-owned and update when any API checks or requests a grant. */
export class LocationPermissionEvents extends Context.Service<
  LocationPermissionEvents,
  {
    readonly revision: () => number;
    readonly publish: (
      permission: LocationPermission,
      expectedRevision?: number
    ) => void;
    readonly listen: (
      receive: (permission: LocationPermission) => void
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("radical/LocationPermissionEvents") {}

export const publishLocationPermission = (permission: LocationPermission) =>
  Effect.gen(function* () {
    const events = yield* Effect.serviceOption(LocationPermissionEvents);

    if (Option.isSome(events)) {
      events.value.publish(permission);
    }
  });
