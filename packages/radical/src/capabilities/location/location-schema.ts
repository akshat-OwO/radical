// oxlint-disable eslint/max-classes-per-file -- Location failures share their schema boundary.
import { Schema } from "effect";

export { PermissionDenied, Unavailable } from "../../core/errors.ts";

const nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const LocationFixSchema = Schema.Struct({
  latitude: Schema.Finite.check(
    Schema.isBetween({ minimum: -90, maximum: 90 })
  ),
  longitude: Schema.Finite.check(
    Schema.isBetween({ minimum: -180, maximum: 180 })
  ),
  accuracy: nonnegative,
  altitude: Schema.NullOr(Schema.Finite),
  altitudeAccuracy: Schema.NullOr(nonnegative),
  heading: Schema.NullOr(
    Schema.Finite.check(
      Schema.isBetween({ minimum: 0, maximum: 360, exclusiveMaximum: true })
    )
  ),
  speed: Schema.NullOr(nonnegative),
  timestamp: nonnegative,
});

export type LocationFix = typeof LocationFixSchema.Type;

export const LocationPermissionSchema = Schema.Struct({
  state: Schema.Literals(["granted", "denied", "prompt"]),
  precision: Schema.Literals(["precise", "approximate", "unknown"]),
});

export type LocationPermission = typeof LocationPermissionSchema.Type;

export class LocationServicesOff extends Schema.TaggedError<LocationServicesOff>()(
  "LocationServicesOff",
  {}
) {}

export class LocationTimeout extends Schema.TaggedError<LocationTimeout>()(
  "LocationTimeout",
  {}
) {}

const purpose = Schema.String.check(
  Schema.makeFilter(
    (text) =>
      text.trim().length > 0 &&
      text
        .split("")
        .every(
          (char) => (char.codePointAt(0) ?? 0) >= 32 || "\t\n\r".includes(char)
        )
  )
);

export const LocationConfigSchema = Schema.Struct({
  usageDescription: purpose,
  precisePurposes: Schema.optional(
    Schema.Record(Schema.String, purpose).check(
      Schema.makeFilter((purposes) =>
        Object.keys(purposes).every(Schema.is(purpose))
      )
    )
  ),
  replaceNavigator: Schema.optional(Schema.Boolean),
});

export interface LocationOptions {
  readonly enableHighAccuracy?: boolean;
  readonly timeout?: number;
  readonly maximumAge?: number;
}

export interface LocationRequestOptions {
  readonly precise?: string;
}
