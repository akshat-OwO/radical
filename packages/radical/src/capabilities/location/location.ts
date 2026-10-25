import { Effect, Option, Schema, Stream, Queue } from "effect";

import {
  Bridge,
  BridgeDecodeError,
  BridgeUnavailable,
  callBridge,
} from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import { BrowserLocation } from "./browser-location.ts";
import {
  LocationPermissionEvents,
  publishLocationPermission,
} from "./location-permission-events.ts";
import { nativeLocationPermission } from "./location-plugin.ts";
import {
  LocationFixSchema,
  LocationServicesOff,
  LocationTimeout,
  PermissionDenied,
  Unavailable,
} from "./location-schema.ts";
import type {
  LocationFix,
  LocationPermission,
  LocationOptions,
  LocationRequestOptions,
} from "./location-schema.ts";

export {
  LocationFixSchema,
  LocationPermissionSchema,
  LocationConfigSchema,
  LocationServicesOff,
  LocationTimeout,
  PermissionDenied,
  Unavailable,
} from "./location-schema.ts";

export type {
  LocationFix,
  LocationPermission,
  LocationOptions,
  LocationRequestOptions,
} from "./location-schema.ts";

export {
  BrowserLocation,
  BrowserLocationLive,
  browserLocationLayer,
} from "./browser-location.ts";

export type LocationError =
  | BridgeError
  | PermissionDenied
  | Unavailable
  | LocationServicesOff
  | LocationTimeout;

const coded = Schema.is(Schema.Struct({ code: Schema.Unknown }));

export const normalizeLocationError = (error: BridgeError): LocationError => {
  if (error._tag !== "BridgeCallFailed") {
    return error;
  }

  const code = coded(error.cause) ? error.cause.code : undefined;

  if (code === "OS-PLUG-GLOC-0007" || code === "OS-PLUG-GLOC-0009") {
    return new LocationServicesOff({});
  }

  if (code === "OS-PLUG-GLOC-0003" || code === "OS-PLUG-GLOC-0008") {
    return new PermissionDenied({});
  }

  if (code === "OS-PLUG-GLOC-0010") {
    return new LocationTimeout({});
  }

  return error;
};

const native = <A, R>(effect: Effect.Effect<A, BridgeError, R>) =>
  effect.pipe(Effect.mapError(normalizeLocationError));

const position = Schema.Struct({
  coords: Schema.Unknown,
  timestamp: Schema.Finite,
});

const negativeMeasurement = Schema.is(
  Schema.Finite.check(Schema.isLessThan(0))
);

const coordinates = Schema.Struct({
  latitude: Schema.Unknown,
  longitude: Schema.Unknown,
  accuracy: Schema.Unknown,
  altitude: Schema.optional(Schema.Unknown),
  altitudeAccuracy: Schema.optional(Schema.Unknown),
  heading: Schema.optional(Schema.Unknown),
  speed: Schema.optional(Schema.Unknown),
});

/** DOM coordinate properties live on the prototype; read each field explicitly. */
const decodePosition = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the Schema decoding boundary for native and DOM callbacks.
  value: unknown,
  source: "browser" | "native"
): Effect.Effect<LocationFix, BridgeDecodeError> =>
  Schema.decodeUnknownEffect(position)(value).pipe(
    Effect.flatMap((fix) =>
      Schema.decodeUnknownEffect(coordinates)(fix.coords).pipe(
        Effect.flatMap((coords) => {
          const invalidAltitude =
            source === "native" && negativeMeasurement(coords.altitudeAccuracy);

          return Schema.decodeUnknownEffect(LocationFixSchema)({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            altitude: invalidAltitude ? null : (coords.altitude ?? null),
            altitudeAccuracy: invalidAltitude
              ? null
              : (coords.altitudeAccuracy ?? null),
            heading:
              source === "native" && negativeMeasurement(coords.heading)
                ? null
                : (coords.heading ?? null),
            speed:
              source === "native" && negativeMeasurement(coords.speed)
                ? null
                : (coords.speed ?? null),
            timestamp: fix.timestamp,
          });
        })
      )
    ),
    Effect.mapError(
      (cause) =>
        new BridgeDecodeError({
          plugin: "Geolocation",
          method: "position",
          cause,
        })
    )
  );

/** Native sentinels are absent measurements; browser values still require W3C validation. */
export const decodeLocationFix = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decode the browser/native callback boundary with Schema.
  value: unknown
) => decodePosition(value, "browser");

export const decodeNativeLocationFix = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decode upstream native payloads before exposing W3C fixes.
  value: unknown
) => decodePosition(value, "native");

const accuracy = Schema.Struct({
  precision: Schema.Literals(["precise", "approximate"]),
});

const readPermission = (
  request: boolean,
  options: LocationRequestOptions = {}
) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const runtime = yield* bridge.runtime;

    if (runtime === "browser") {
      const browser = yield* BrowserLocation;

      if (request) {
        yield* browser.current({ enableHighAccuracy: false });

        return {
          state: "granted",
          precision: "unknown",
        } satisfies LocationPermission;
      }

      return yield* browser.check;
    }

    const result = yield* native(
      callBridge(
        "RadicalLocation",
        request ? "requestPermissions" : "checkPermissions",
        nativeLocationPermission,
        request
          ? {
              permissions: [
                options.precise === undefined ? "coarseLocation" : "location",
              ],
            }
          : {}
      )
    );

    const grant =
      result.coarseLocation === "granted" || result.location === "granted";

    let precision: LocationPermission["precision"] = "unknown";

    if (grant) {
      // Report actual grants, including FINE acquired through the shared permission group before Android 12.
      precision = result.location === "granted" ? "precise" : "approximate";
    }

    if (runtime === "ios" && grant) {
      const response = yield* native(
        callBridge(
          "RadicalLocation",
          request && options.precise !== undefined
            ? "requestTemporaryFullAccuracy"
            : "accuracyAuthorization",
          accuracy,
          options.precise === undefined ? {} : { purposeKey: options.precise }
        )
      );

      ({ precision } = response);
    }

    let state: LocationPermission["state"] = "prompt";

    if (grant) {
      state = "granted";
    } else if (
      result.coarseLocation === "denied" ||
      result.location === "denied"
    ) {
      state = "denied";
    }

    return { state, precision } satisfies LocationPermission;
  }).pipe(
    Effect.catchTag("PermissionDenied", () =>
      Effect.succeed<LocationPermission>({
        state: "denied",
        precision: "unknown",
      })
    )
  );

const permission = (request: boolean, options: LocationRequestOptions = {}) =>
  Effect.gen(function* () {
    const events = yield* Effect.serviceOption(LocationPermissionEvents);

    const revision = Option.isSome(events)
      ? events.value.revision()
      : undefined;

    const result = yield* readPermission(request, options);

    if (Option.isSome(events)) {
      // A slow check must not overwrite a permission decision completed after it started.
      events.value.publish(result, request ? undefined : revision);
    }

    return result;
  });

export const checkLocationPermission = permission(false);

export const requestLocationPermission = (
  options: LocationRequestOptions = {}
) => permission(true, options);

export const locationOptions = (
  options: LocationOptions = {}
): Required<LocationOptions> => ({
  enableHighAccuracy: options.enableHighAccuracy ?? false,
  timeout: options.timeout ?? 10_000,
  maximumAge: options.maximumAge ?? 0,
});

/** A high-accuracy hint must never upgrade a grant without an explicit purpose request. */
const nativePositionOptions = (options: LocationOptions) =>
  Effect.gen(function* () {
    const normalized = locationOptions(options);
    const bridge = yield* Bridge;

    // Prefer the age-constrained Fused path with GMS. Non-GMS devices need
    // LocationManager, whose first callback may contain a historical fix.
    const configured =
      (yield* bridge.runtime) === "android"
        ? {
            ...normalized,
            enableLocationFallback: !(yield* native(
              callBridge(
                "RadicalLocation",
                "playServicesAvailability",
                Schema.Struct({ available: Schema.Boolean }),
                {}
              )
            )).available,
          }
        : normalized;

    if (!normalized.enableHighAccuracy) {
      return configured;
    }

    const currentGrant = yield* checkLocationPermission;

    return {
      ...configured,
      enableHighAccuracy: currentGrant.precision === "precise",
    };
  });

/** Refresh once after access: native position methods can grant permission themselves. */
const publishAccessGrant = Effect.gen(function* () {
  const events = yield* Effect.serviceOption(LocationPermissionEvents);

  if (Option.isNone(events)) {
    return;
  }

  const bridge = yield* Bridge;

  if ((yield* bridge.runtime) === "browser") {
    events.value.publish({ state: "granted", precision: "unknown" });
  } else {
    yield* checkLocationPermission.pipe(Effect.ignore);
  }
});

const refreshAccessPermission = Effect.gen(function* () {
  const events = yield* Effect.serviceOption(LocationPermissionEvents);

  if (Option.isSome(events)) {
    yield* checkLocationPermission.pipe(Effect.ignore);
  }
});

const publishAccessError = (error: LocationError) =>
  error._tag === "PermissionDenied"
    ? publishLocationPermission({ state: "denied", precision: "unknown" })
    : refreshAccessPermission;

export const rawLocationWatch = (
  options: LocationOptions
): Stream.Stream<LocationFix, LocationError, Bridge | BrowserLocation> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const bridge = yield* Bridge;
      let notified = false;

      const notify = () => {
        if (notified) {
          return Effect.void;
        }

        notified = true;

        return publishAccessGrant;
      };

      if ((yield* bridge.runtime) === "browser") {
        return (yield* BrowserLocation)
          .watch(options)
          .pipe(Stream.mapEffect(decodeLocationFix), Stream.tap(notify));
      }

      const configured = yield* nativePositionOptions(options);

      return Stream.callback<Effect.Effect<unknown, BridgeError>, BridgeError>(
        (queue) =>
          Effect.gen(function* () {
            if (!bridge.subscribe) {
              return yield* new BridgeUnavailable({
                plugin: "Geolocation",
                method: "watchPosition",
              });
            }

            yield* Effect.acquireRelease(
              bridge.subscribe(
                "Geolocation",
                "watchPosition",
                configured,
                Schema.Unknown,
                (result) => {
                  Queue.offerUnsafe(queue, result);
                },
                { method: "clearWatch", key: "id" }
              ),
              (release) => release
            ).pipe(Effect.asVoid);

            return yield* Effect.void;
          }),
        { bufferSize: 1, strategy: "sliding" }
      ).pipe(
        Stream.mapEffect((result) => native(result)),
        Stream.mapEffect(decodeNativeLocationFix),
        Stream.tap(notify)
      );
    })
  ).pipe(Stream.tapError(publishAccessError));

export const getCurrentLocation = (
  options: LocationOptions = {}
): Effect.Effect<LocationFix, LocationError, Bridge | BrowserLocation> =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const runtime = yield* bridge.runtime;

    const acquisition = Effect.gen(function* () {
      const settings = locationOptions(options);

      if (runtime === "browser") {
        return yield* (yield* BrowserLocation)
          .current(settings)
          .pipe(Effect.flatMap(decodeLocationFix));
      }

      const fix = yield* nativePositionOptions(settings).pipe(
        Effect.flatMap((configured) =>
          native(bridge.call("Geolocation", "getCurrentPosition", configured))
        )
      );

      return yield* decodeNativeLocationFix(fix);
    });

    // ION starts its acquisition timeout after the system settings resolution.
    // An outer Android timer would expire while the user is still in that dialog.
    return yield* runtime === "android"
      ? acquisition
      : acquisition.pipe(
          Effect.timeoutOrElse({
            duration: options.timeout ?? 10_000,
            orElse: () => Effect.fail(new LocationTimeout({})),
          })
        );
  }).pipe(
    Effect.tap(() => publishAccessGrant),
    Effect.tapError(publishAccessError)
  );

export const openLocationServicesSettings = Effect.gen(function* () {
  const bridge = yield* Bridge;

  if ((yield* bridge.runtime) === "browser") {
    return yield* new Unavailable({
      reason: "Location settings require a native shell",
    });
  }

  return yield* native(
    bridge.call("RadicalLocation", "openLocationServicesSettings", {})
  ).pipe(Effect.asVoid);
});
