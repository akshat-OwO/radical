import { Schema } from "effect";

import { CameraConfigSchema } from "./camera-schema.ts";
import { DeviceInfoSchema } from "./device-info-schema.ts";
import {
  GoogleSignInConfigSchema,
  GoogleIdentitySchema,
} from "./google-sign-in-schema.ts";
import { ImpactStyleSchema, NotificationTypeSchema } from "./haptics-schema.ts";
import { NetworkStatusSchema } from "./network-schema.ts";
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

// Android omits null names and types; iOS sends "" and -1/0 for unknown type, size, and date.
const pickedFile = Schema.Struct({
  name: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
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

const videoCommand = {
  args: Schema.Struct({}),
  result: Schema.Unknown,
  errors: {},
};
export const videoStreamPlugin = definePlugin({
  id: "videoStream",
  bridge: "CameraPreview",
  dependencies: { "@capgo/camera-preview": "8.14.2" },
  config: {
    selector: "VideoStream",
    schema: Schema.Struct({
      usageDescription: CameraConfigSchema.fields.usageDescription,
    }),
  },
  commands: {
    start: {
      ...videoCommand,
      args: Schema.Struct({
        position: Schema.Literals(["rear", "front"]),
        aspectRatio: Schema.Literal("fill"),
        toBack: Schema.Literal(true),
        disableAudio: Schema.Literal(true),
        barcodeScanner: Schema.Struct({
          formats: Schema.Array(Schema.Literal("qr_code")),
          detectionInterval: Schema.Finite,
        }),
      }),
    },
    getAvailableDevices: {
      ...videoCommand,
      result: Schema.Struct({ devices: Schema.Array(Schema.Unknown) }),
    },
    stop: videoCommand,
    flip: videoCommand,
    requestPermissions: {
      ...videoCommand,
      args: Schema.Struct({ disableAudio: Schema.Literal(true) }),
      result: cameraPermissions,
    },
    getZoom: {
      ...videoCommand,
      result: Schema.Struct({
        min: Schema.Finite,
        max: Schema.Finite,
        current: Schema.Finite,
      }),
    },
    setZoom: { ...videoCommand, args: Schema.Struct({ level: Schema.Finite }) },
    getSupportedFlashModes: {
      ...videoCommand,
      result: Schema.Struct({ result: Schema.Array(Schema.String) }),
    },
    setFlashMode: {
      ...videoCommand,
      args: Schema.Struct({ flashMode: Schema.Literals(["off", "torch"]) }),
    },
    getVideoFrameRate: {
      ...videoCommand,
      result: Schema.Struct({ frameRate: Schema.Finite }),
    },
  },
});

// Haptics 8.0.2 has no plugin-specific rejection codes or result payloads.
const hapticCompletion = { result: Schema.Unknown, errors: {} };
const selectionCommand = { ...hapticCompletion, args: Schema.Struct({}) };
export const hapticsPlugin = definePlugin({
  id: "haptics",
  bridge: "Haptics",
  dependencies: { "@capacitor/haptics": "8.0.2" },
  commands: {
    impact: {
      ...hapticCompletion,
      args: Schema.Struct({ style: ImpactStyleSchema }),
    },
    notification: {
      ...hapticCompletion,
      args: Schema.Struct({ type: NotificationTypeSchema }),
    },
    selectionStart: selectionCommand,
    selectionChanged: selectionCommand,
    selectionEnd: selectionCommand,
  },
});

export const networkPlugin = definePlugin({
  id: "network",
  bridge: "Network",
  dependencies: { "@capacitor/network": "8.0.1" },
  commands: {
    getStatus: {
      args: Schema.Struct({}),
      result: NetworkStatusSchema,
      errors: {},
    },
  },
});

export const googleSignInPlugin = definePlugin({
  id: "googleSignIn",
  bridge: "GoogleSignIn",
  dependencies: { "@capawesome/capacitor-google-sign-in": "0.1.4" },
  config: { selector: "GoogleSignIn", schema: GoogleSignInConfigSchema },
  commands: {
    initialize: {
      args: Schema.Struct({ clientId: Schema.NonEmptyString }),
      result: Schema.Unknown,
      errors: {},
    },
    signIn: {
      args: Schema.Struct({}),
      result: GoogleIdentitySchema,
      errors: {},
    },
  },
});

export {
  localNotificationsPlugin,
  badgePlugin,
  firebaseMessagingPlugin,
  notificationTopicsPlugin,
} from "./notification-plugins.ts";
