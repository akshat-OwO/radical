import { Schema } from "effect";

import { CameraConfigSchema } from "./camera-schema.ts";
import { DeviceInfoSchema } from "./device-info-schema.ts";
import { definePlugin } from "./plugins.ts";

export const devicePlugin = definePlugin({
  id: "device",
  bridge: "Device",
  dependencies: { "@capacitor/device": "^8.0.3" },
  commands: {
    getInfo: { args: Schema.Struct({}), result: DeviceInfoSchema, errors: {} },
  },
});
const args = Schema.Struct({ id: Schema.String });
const command = { args, result: args, errors: {} };
export const transitionsPlugin = definePlugin({
  id: "transitions",
  bridge: "RadicalTransitions",
  dependencies: {},
  commands: {
    cover: command,
    remove: command,
    reveal: {
      ...command,
      args: Schema.Struct({
        id: Schema.String,
        kind: Schema.Literals(["slide", "fade"]),
        direction: Schema.Literals(["forward", "back"]),
        reducedMotion: Schema.Boolean,
      }),
    },
  },
  android: {
    className: "RadicalTransitionsPlugin",
    sources: [
      {
        file: "RadicalTransitionsPlugin.java",
        source: "templates/android/RadicalTransitionsPlugin.java",
      },
    ],
    dependencies: {},
  },
  ios: {
    className: "RadicalTransitionsPlugin",
    sources: [
      {
        file: "RadicalTransitionsPlugin.swift",
        source: "templates/ios/RadicalTransitionsPlugin.swift",
      },
    ],
    dependencies: [],
  },
});

const cameraMedia = Schema.Struct({
  uri: Schema.NonEmptyString,
  metadata: Schema.optional(
    Schema.Struct({
      format: Schema.optional(Schema.String),
      resolution: Schema.optional(Schema.String),
    })
  ),
});
const cameraPermissions = Schema.Struct({
  camera: Schema.Literals([
    "granted",
    "denied",
    "prompt",
    "prompt-with-rationale",
  ]),
});
export const cameraPlugin = definePlugin({
  id: "camera",
  bridge: "Camera",
  dependencies: { "@capacitor/camera": "8.2.6" },
  config: { selector: "Camera", schema: CameraConfigSchema },
  commands: {
    takePhoto: {
      args: Schema.Struct({
        saveToGallery: Schema.Literal(false),
        includeMetadata: Schema.Literal(true),
      }),
      result: cameraMedia,
      errors: {},
    },
    chooseFromGallery: {
      args: Schema.Struct({
        mediaType: Schema.Literal(0),
        allowMultipleSelection: Schema.Literal(false),
        includeMetadata: Schema.Literal(true),
      }),
      result: Schema.Struct({ results: Schema.Array(cameraMedia) }),
      errors: {},
    },
    checkPermissions: {
      args: Schema.Struct({}),
      result: cameraPermissions,
      errors: {},
    },
    requestPermissions: {
      args: Schema.Struct({
        permissions: Schema.Array(Schema.Literal("camera")),
      }),
      result: cameraPermissions,
      errors: {},
    },
  },
});
