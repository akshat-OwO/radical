import { Schema } from "effect";

import { definePlugin } from "../../core/plugins/plugins.ts";
import { NotificationScheduleResultSchema } from "./notification-schema.ts";

const empty = Schema.Struct({});
const voidCommand = { args: empty, result: Schema.Unknown, errors: {} };
const permissions = Schema.Struct({
  display: Schema.Literals([
    "granted",
    "denied",
    "prompt",
    "prompt-with-rationale",
  ]),
});
export const localNotificationsPlugin = definePlugin({
  id: "localNotifications",
  bridge: "LocalNotifications",
  dependencies: { "@capacitor/local-notifications": "8.3.1" },
  commands: {
    checkPermissions: { ...voidCommand, result: permissions },
    requestPermissions: { ...voidCommand, result: permissions },
    checkExactNotificationSetting: {
      ...voidCommand,
      result: Schema.Struct({
        exact_alarm: Schema.Literals(["granted", "denied"]),
      }),
    },
    changeExactNotificationSetting: {
      ...voidCommand,
      result: Schema.Struct({
        exact_alarm: Schema.Literals(["granted", "denied"]),
      }),
    },
    schedule: {
      ...voidCommand,
      result: NotificationScheduleResultSchema,
      args: Schema.Struct({
        notifications: Schema.Array(
          Schema.Struct({
            id: Schema.Int,
            title: Schema.String,
            body: Schema.optional(Schema.String),
            schedule: Schema.Struct({ at: Schema.String }),
            extra: Schema.Struct({ route: Schema.optional(Schema.String) }),
          })
        ),
      }),
    },
    cancel: {
      ...voidCommand,
      args: Schema.Struct({
        notifications: Schema.Array(Schema.Struct({ id: Schema.Int })),
      }),
    },
  },
});
export const badgePlugin = definePlugin({
  id: "badge",
  bridge: "Badge",
  dependencies: { "@capawesome/capacitor-badge": "8.0.4" },
  commands: {
    isSupported: {
      ...voidCommand,
      result: Schema.Struct({ isSupported: Schema.Boolean }),
    },
    set: { ...voidCommand, args: Schema.Struct({ count: Schema.Int }) },
    get: { ...voidCommand, result: Schema.Struct({ count: Schema.Int }) },
  },
});
export const firebaseMessagingPlugin = definePlugin({
  id: "firebaseMessaging",
  bridge: "FirebaseMessaging",
  dependencies: { "@capacitor-firebase/messaging": "8.5.2" },
  commands: {
    getToken: {
      ...voidCommand,
      result: Schema.Struct({ token: Schema.NonEmptyString }),
    },
  },
});
export const notificationTopicsPlugin = definePlugin({
  id: "notificationTopics",
  bridge: "RadicalNotificationTopics",
  dependencies: {},
  commands: {
    status: {
      ...voidCommand,
      result: Schema.Struct({ configured: Schema.Boolean }),
    },
    subscribe: {
      ...voidCommand,
      args: Schema.Struct({ topic: Schema.String }),
    },
    unsubscribe: {
      ...voidCommand,
      args: Schema.Struct({ topic: Schema.String }),
    },
    list: {
      ...voidCommand,
      result: Schema.Struct({ topics: Schema.Array(Schema.String) }),
    },
  },
  android: {
    className: "RadicalNotificationTopicsPlugin",
    sources: [
      {
        file: "RadicalNotificationTopicsPlugin.java",
        source: "templates/android/RadicalNotificationTopicsPlugin.java",
      },
    ],
    dependencies: { "com.google.firebase:firebase-messaging": "25.0.1" },
  },
  ios: {
    className: "RadicalNotificationTopicsPlugin",
    sources: [
      {
        file: "RadicalNotificationTopicsPlugin.swift",
        source: "templates/ios/RadicalNotificationTopicsPlugin.swift",
      },
    ],
    dependencies: ["FirebaseCore", "FirebaseMessaging"].map((product) => ({
      url: "https://github.com/firebase/firebase-ios-sdk.git",
      version: "^12.7.0",
      product,
    })),
  },
});
