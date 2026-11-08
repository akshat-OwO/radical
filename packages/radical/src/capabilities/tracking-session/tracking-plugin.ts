import { Schema } from "effect";

import { PermissionDenied, Unavailable } from "../../core/errors.ts";
import { definePlugin } from "../../core/plugins/plugins.ts";
import { LocationServicesOff } from "../location/location-schema.ts";
import {
  TrackingConfigSchema,
  TrackingOptionsSchema,
  TrackingSessionSchema,
  TrackingSessionAlreadyActive,
  TrackingSessionNotFound,
  TrackingStartRequiresForeground,
  InvalidTrackingOptions,
} from "./tracking-schema.ts";

export const trackingSessionPlugin = definePlugin({
  id: "trackingSession",
  bridge: "RadicalTrackingSession",
  dependencies: {},
  config: { selector: "TrackingSession", schema: TrackingConfigSchema },
  commands: {
    startTrackingSession: {
      args: TrackingOptionsSchema,
      result: TrackingSessionSchema,
      errors: {
        TrackingSessionAlreadyActive,
        TrackingStartRequiresForeground,
        InvalidTrackingOptions,
        LocationServicesOff,
        PermissionDenied,
        Unavailable,
      },
    },
    getTrackingSession: {
      args: Schema.Struct({}),
      result: Schema.Struct({ session: Schema.NullOr(TrackingSessionSchema) }),
      errors: { Unavailable },
    },
    stopTrackingSession: {
      args: Schema.Struct({ id: Schema.String }),
      result: TrackingSessionSchema,
      errors: { TrackingSessionNotFound, Unavailable },
    },
  },
  ios: {
    className: "RadicalTrackingSessionPlugin",
    dependencies: [],
    sources: [
      {
        file: "RadicalTrackingSessionPlugin.swift",
        source: "templates/ios/RadicalTrackingSessionPlugin.swift",
      },
    ],
  },
  android: {
    className: "RadicalTrackingSessionPlugin",
    sources: ["RadicalTrackingSessionPlugin", "RadicalTrackingService"].map(
      (name) => ({
        file: `${name}.java`,
        source: `templates/android/${name}.java`,
      })
    ),
    dependencies: { "com.google.android.gms:play-services-location": "21.3.0" },
  },
});
