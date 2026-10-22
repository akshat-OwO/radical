import { Schema } from "effect";

/** Common subset of the official Device.getInfo result and browser observations. */
export const DeviceInfoSchema = Schema.Struct({
  platform: Schema.Literals(["android", "ios", "web"]),
  model: Schema.String,
  operatingSystem: Schema.Literals([
    "android",
    "ios",
    "windows",
    "mac",
    "linux",
    "unknown",
  ]),
  osVersion: Schema.String,
  manufacturer: Schema.String,
  isVirtual: Schema.Boolean,
});

export type DeviceInfo = typeof DeviceInfoSchema.Type;
