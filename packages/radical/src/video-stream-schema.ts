import { Schema } from "effect";
import type { Effect } from "effect";

import type { Bridge, BridgeError } from "./bridge.ts";
import type { PermissionDenied, Unavailable } from "./camera-schema.ts";

export type VideoStreamError = BridgeError | PermissionDenied | Unavailable;
export type CameraFacing = "front" | "rear";
export const VideoStreamInfoSchema = Schema.Struct({
  facing: Schema.Literals(["front", "rear"]),
  zoom: Schema.optional(
    Schema.Struct({
      min: Schema.Finite,
      max: Schema.Finite,
      current: Schema.Finite,
    })
  ),
  torch: Schema.Boolean,
  torchAvailable: Schema.Boolean,
  frameRate: Schema.optional(Schema.Finite),
  detectionAvailable: Schema.Boolean,
});
export type VideoStreamInfo = typeof VideoStreamInfoSchema.Type;
export interface VideoStreamSession {
  readonly info: Effect.Effect<VideoStreamInfo, VideoStreamError, Bridge>;
  readonly switchCamera: Effect.Effect<void, VideoStreamError, Bridge>;
  readonly setZoom: (
    level: number
  ) => Effect.Effect<void, VideoStreamError, Bridge>;
  readonly setTorch: (
    enabled: boolean
  ) => Effect.Effect<void, VideoStreamError, Bridge>;
}
export interface VideoStreamOptions {
  /** A transparent hole in the app's overlay. Browser video is mounted here. */
  readonly viewfinder: HTMLElement;
  readonly facing?: CameraFacing;
  readonly onDetect?: (value: string) => void;
}
