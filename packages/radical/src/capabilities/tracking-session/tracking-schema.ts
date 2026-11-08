// oxlint-disable eslint/max-classes-per-file -- Tracking failures share the protocol schema.
import { Schema } from "effect";

import { Unavailable } from "../../core/errors.ts";
import {
  LocationFixSchema,
  LocationPermissionSchema,
  LocationTimeout,
  LocationServicesOff,
} from "../location/location-schema.ts";

export const TrackingOptionsSchema = Schema.Struct({
  preset: Schema.Literals(["balanced", "fitness", "navigation"]),
  interval: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  minimumDistance: Schema.optional(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
  ),
});

export type TrackingOptions = typeof TrackingOptionsSchema.Type;

export const TrackingStatusSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("running") }),
  Schema.Struct({
    state: Schema.Literal("suspended"),
    reason: Schema.Literal("servicesOff"),
  }),
  Schema.Struct({
    state: Schema.Literal("stopped"),
    reason: Schema.Literals(["user", "permissionRevoked"]),
  }),
  Schema.Struct({
    state: Schema.Literal("interrupted"),
    reason: Schema.Literal("termination"),
  }),
]);

export type TrackingStatus = typeof TrackingStatusSchema.Type;

export const TrackingAcquisitionErrorSchema = Schema.Union([
  LocationTimeout,
  LocationServicesOff,
  Unavailable,
]);

export type TrackingAcquisitionError =
  typeof TrackingAcquisitionErrorSchema.Type;

export const TrackingSessionSchema = Schema.Struct({
  id: Schema.String,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  startedAt: Schema.Finite,
  options: TrackingOptionsSchema,
  status: TrackingStatusSchema,
  latest: Schema.NullOr(LocationFixSchema),
  permission: LocationPermissionSchema,
  lastError: Schema.NullOr(TrackingAcquisitionErrorSchema),
});

export type TrackingSession = typeof TrackingSessionSchema.Type;

export class TrackingSessionAlreadyActive extends Schema.TaggedError<TrackingSessionAlreadyActive>()(
  "TrackingSessionAlreadyActive",
  { id: Schema.String }
) {}

export class TrackingSessionNotFound extends Schema.TaggedError<TrackingSessionNotFound>()(
  "TrackingSessionNotFound",
  { id: Schema.String }
) {}

export class TrackingStartRequiresForeground extends Schema.TaggedError<TrackingStartRequiresForeground>()(
  "TrackingStartRequiresForeground",
  {}
) {}

export class InvalidTrackingOptions extends Schema.TaggedError<InvalidTrackingOptions>()(
  "InvalidTrackingOptions",
  { message: Schema.String }
) {}

export const TrackingConfigSchema = Schema.Struct({
  usageDescription: Schema.NonEmptyString,
  notificationTitle: Schema.optional(Schema.NonEmptyString),
  notificationBody: Schema.optional(Schema.NonEmptyString),
  stopActionLabel: Schema.optional(Schema.NonEmptyString),
});
