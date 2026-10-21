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

const pickedFile = Schema.Struct({
  name: Schema.String,
  mimeType: Schema.String,
  size: Schema.Finite,
  path: Schema.optional(Schema.String),
  modifiedAt: Schema.optional(Schema.Finite),
});
export const filePickerPlugin = definePlugin({
  id: "filePicker",
  bridge: "FilePicker",
  dependencies: { "@capawesome/capacitor-file-picker": "8.1.1" },
  commands: {
    pickFiles: {
      args: Schema.Struct({
        types: Schema.optional(Schema.Array(Schema.String)),
        limit: Schema.Literals([0, 1]),
        readData: Schema.Literal(false),
      }),
      result: Schema.Struct({ files: Schema.Array(pickedFile) }),
      errors: {},
    },
  },
});
export const appLauncherPlugin = definePlugin({
  id: "appLauncher",
  bridge: "AppLauncher",
  dependencies: { "@capacitor/app-launcher": "8.0.1" },
  commands: {
    openUrl: {
      args: Schema.Struct({ url: Schema.String }),
      result: Schema.Struct({ completed: Schema.Boolean }),
      errors: {},
    },
  },
});
export const fileOpenerPlugin = definePlugin({
  id: "fileOpener",
  bridge: "FileOpener",
  dependencies: { "@capacitor-community/file-opener": "8.0.1" },
  commands: {
    open: {
      args: Schema.Struct({
        filePath: Schema.String,
        contentType: Schema.optional(Schema.String),
        openWithDefault: Schema.Boolean,
      }),
      result: Schema.Unknown,
      errors: {},
    },
  },
});
