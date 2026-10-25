import { Schema } from "effect";

import { definePlugin } from "../../core/plugins/plugins.ts";
import { LocationConfigSchema } from "./location-schema.ts";

export const nativeLocationPermission = Schema.Struct({
  location: Schema.Literals([
    "granted",
    "denied",
    "prompt",
    "prompt-with-rationale",
  ]),
  coarseLocation: Schema.Literals([
    "granted",
    "denied",
    "prompt",
    "prompt-with-rationale",
  ]),
});

const permissionCommands = {
  checkPermissions: {
    args: Schema.Struct({}),
    result: nativeLocationPermission,
    errors: {},
  },
  requestPermissions: {
    args: Schema.Struct({
      permissions: Schema.Array(
        Schema.Literals(["location", "coarseLocation"])
      ),
    }),
    result: nativeLocationPermission,
    errors: {},
  },
};

export const locationPlugin = definePlugin({
  id: "location",
  bridge: "Geolocation",
  dependencies: { "@capacitor/geolocation": "8.2.4" },
  config: { selector: "Location", schema: LocationConfigSchema },
  commands: {
    ...permissionCommands,
    getCurrentPosition: {
      args: Schema.Record(Schema.String, Schema.Unknown),
      result: Schema.Unknown,
      errors: {},
    },
  },
});

export const locationPrecisionPlugin = definePlugin({
  id: "locationPrecision",
  bridge: "RadicalLocation",
  dependencies: {},
  commands: {
    ...permissionCommands,
    playServicesAvailability: {
      args: Schema.Struct({}),
      result: Schema.Struct({ available: Schema.Boolean }),
      errors: {},
    },
    accuracyAuthorization: {
      args: Schema.Struct({}),
      result: Schema.Struct({
        precision: Schema.Literals(["precise", "approximate"]),
      }),
      errors: {},
    },
    requestTemporaryFullAccuracy: {
      args: Schema.Struct({ purposeKey: Schema.NonEmptyString }),
      result: Schema.Struct({
        precision: Schema.Literals(["precise", "approximate"]),
      }),
      errors: {},
    },
    openLocationServicesSettings: {
      args: Schema.Struct({}),
      result: Schema.Unknown,
      errors: {},
    },
  },
  ios: {
    className: "RadicalLocationPlugin",
    sources: [
      {
        file: "RadicalLocationPlugin.swift",
        source: "templates/ios/RadicalLocationPlugin.swift",
      },
    ],
    dependencies: [],
  },
  android: {
    className: "RadicalLocationPlugin",
    sources: [
      {
        file: "RadicalLocationPlugin.java",
        source: "templates/android/RadicalLocationPlugin.java",
      },
    ],
    dependencies: { "com.google.android.gms:play-services-base": "18.5.0" },
  },
});
