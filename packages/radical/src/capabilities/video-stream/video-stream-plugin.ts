import { Schema } from "effect";

import { definePlugin } from "../../core/plugins/plugins.ts";
import { cameraPermissions } from "../camera/camera-plugin.ts";
import { CameraConfigSchema } from "../camera/camera-schema.ts";

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
