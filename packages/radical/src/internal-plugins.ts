import { Schema } from "effect";

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
