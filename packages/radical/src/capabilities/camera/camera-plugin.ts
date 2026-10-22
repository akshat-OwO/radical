import { Schema } from "effect";

import { definePlugin } from "../../core/plugins/plugins.ts";
import { CameraConfigSchema } from "./camera-schema.ts";

const cameraMedia = Schema.Struct({
  uri: Schema.NonEmptyString,
  metadata: Schema.optional(
    Schema.Struct({
      format: Schema.optional(Schema.String),
      resolution: Schema.optional(Schema.String),
    })
  ),
});

export const cameraPermissions = Schema.Struct({
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
