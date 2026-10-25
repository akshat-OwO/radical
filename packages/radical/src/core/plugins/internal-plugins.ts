import { Schema } from "effect";

import { DataProtectionStatusSchema } from "../../capabilities/data-protection/data-protection-schema.ts";
import { DeviceInfoSchema } from "../../capabilities/device-info/device-info-schema.ts";
import {
  ImpactStyleSchema,
  NotificationTypeSchema,
} from "../../capabilities/haptics/haptics-schema.ts";
import { NetworkStatusSchema } from "../../capabilities/network/network-schema.ts";
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
        // History index of the covered page. Forward slides retain its snapshot.
        index: Schema.optional(Schema.Int),
      }),
    },
    setBack: {
      args: Schema.Struct({
        handles: Schema.Boolean,
        pop: Schema.Boolean,
        index: Schema.Int,
      }),
      result: Schema.Struct({}),
      errors: {},
    },
    exit: { args: Schema.Struct({}), result: Schema.Struct({}), errors: {} },
    settle: { args: Schema.Struct({}), result: Schema.Struct({}), errors: {} },
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

export {
  localNotificationsPlugin,
  badgePlugin,
  firebaseMessagingPlugin,
  notificationTopicsPlugin,
} from "../../capabilities/notifications/notification-plugins.ts";

export const dataProtectionPlugin = definePlugin({
  id: "dataProtection",
  bridge: "RadicalDataProtection",
  dependencies: {},
  commands: {
    setProtection: {
      args: Schema.Struct({ enabled: Schema.Boolean }),
      result: DataProtectionStatusSchema,
      errors: {},
    },
    clearWebData: {
      args: Schema.Struct({}),
      result: Schema.Unknown,
      errors: {},
    },
  },
  android: {
    className: "RadicalDataProtectionPlugin",
    sources: [
      {
        file: "RadicalDataProtectionPlugin.java",
        source: "templates/android/RadicalDataProtectionPlugin.java",
      },
    ],
    dependencies: {},
  },
  ios: {
    className: "RadicalDataProtectionPlugin",
    sources: [
      {
        file: "RadicalDataProtectionPlugin.swift",
        source: "templates/ios/RadicalDataProtectionPlugin.swift",
      },
    ],
    dependencies: [],
  },
});

export { cameraPlugin } from "../../capabilities/camera/camera-plugin.ts";

export { videoStreamPlugin } from "../../capabilities/video-stream/video-stream-plugin.ts";

export { googleSignInPlugin } from "../../capabilities/google-sign-in/google-sign-in-plugin.ts";

export {
  locationPlugin,
  locationPrecisionPlugin,
} from "../../capabilities/location/location-plugin.ts";

export const settingsPlugin = definePlugin({
  id: "settings",
  bridge: "RadicalSettings",
  dependencies: {},
  commands: {
    openAppSettings: {
      args: Schema.Struct({}),
      result: Schema.Unknown,
      errors: {},
    },
  },
  ios: {
    className: "RadicalSettingsPlugin",
    sources: [
      {
        file: "RadicalSettingsPlugin.swift",
        source: "templates/ios/RadicalSettingsPlugin.swift",
      },
    ],
    dependencies: [],
  },
  android: {
    className: "RadicalSettingsPlugin",
    sources: [
      {
        file: "RadicalSettingsPlugin.java",
        source: "templates/android/RadicalSettingsPlugin.java",
      },
    ],
    dependencies: {},
  },
});
