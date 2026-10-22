import type { Scope } from "effect";
import { Effect, Option, Schema } from "effect";

import type { BridgeError } from "./bridge.ts";
import { Bridge, BridgeUnavailable } from "./bridge.ts";
import {
  BrowserVideoStream,
  BrowserVideoStreamLive,
} from "./browser-video-stream.ts";
import { PermissionDenied, Unavailable } from "./camera-schema.ts";
import { videoStreamPlugin } from "./internal-plugins.ts";
import { createPluginClient } from "./plugins.ts";
import type {
  VideoStreamOptions,
  VideoStreamSession,
  VideoStreamError,
} from "./video-stream-schema.ts";

export { VideoStreamInfoSchema } from "./video-stream-schema.ts";
export type {
  VideoStreamOptions,
  VideoStreamSession,
  VideoStreamInfo,
  VideoStreamError,
  CameraFacing,
} from "./video-stream-schema.ts";
export {
  BrowserVideoStream,
  BrowserVideoStreamLive,
} from "./browser-video-stream.ts";
const native = createPluginClient(videoStreamPlugin);
const nativeError = <A, R>(effect: Effect.Effect<A, BridgeError, R>) =>
  effect.pipe(
    Effect.catchTag(
      "BridgeCallFailed",
      (error): Effect.Effect<never, VideoStreamError> => {
        const { cause } = error;
        return typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "cameraPermissionDenied"
          ? Effect.fail(new PermissionDenied({}))
          : Effect.fail(error);
      }
    )
  );
const barcodeEvent = Schema.Struct({
  barcodes: Schema.Array(
    Schema.Struct({ format: Schema.String, value: Schema.String })
  ),
});

/** The caller's scope owns the camera, event listeners, and presentation. */
export const startVideoStream = (
  options: VideoStreamOptions
): Effect.Effect<
  VideoStreamSession,
  VideoStreamError,
  Bridge | BrowserVideoStream | Scope.Scope
> =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const browser = yield* BrowserVideoStream;
    if ((yield* bridge.runtime) === "browser") {
      return yield* browser.start(options);
    }
    const permission = yield* nativeError(
      native.requestPermissions({ disableAudio: true })
    );
    if (permission.camera !== "granted") {
      return yield* new PermissionDenied({});
    }
    const { devices } = yield* native.getAvailableDevices({});
    if (devices.length === 0) {
      return yield* new Unavailable({ reason: "No camera available" });
    }
    if (!bridge.listen) {
      return yield* new BridgeUnavailable({
        plugin: "CameraPreview",
        method: "addListener",
      });
    }
    let facing = options.facing ?? "rear";
    let torch = false;
    yield* Effect.acquireRelease(
      bridge.listen("CameraPreview", "barcodeScanned", (event) => {
        const decoded = Schema.decodeUnknownOption(barcodeEvent)(event);
        if (Option.isSome(decoded)) {
          for (const barcode of decoded.value.barcodes) {
            if (barcode.format === "qr_code") {
              options.onDetect?.(barcode.value);
            }
          }
        }
      }),
      (release) => release
    ).pipe(Effect.asVoid);
    yield* Effect.acquireRelease(
      browser.present(options.viewfinder),
      (release) => Effect.sync(release)
    );
    // Acquire is uninterruptible: a late native start must settle before stop is sent.
    yield* Effect.acquireRelease(
      nativeError(
        native.start({
          position: facing,
          aspectRatio: "fill",
          toBack: true,
          disableAudio: true,
          barcodeScanner: { formats: ["qr_code"], detectionInterval: 500 },
        })
      ).pipe(Effect.onError(() => native.stop({}).pipe(Effect.ignore))),
      () => native.stop({}).pipe(Effect.ignore)
    );
    const info = Effect.gen(function* () {
      const zoom = yield* native.getZoom({}).pipe(Effect.option);
      const flash = yield* native
        .getSupportedFlashModes({})
        .pipe(Effect.option);
      const rate = yield* native.getVideoFrameRate({}).pipe(Effect.option);
      return {
        facing,
        torch,
        torchAvailable:
          Option.isSome(flash) && flash.value.result.includes("torch"),
        zoom: Option.getOrUndefined(zoom),
        frameRate: Option.isSome(rate) ? rate.value.frameRate : undefined,
        detectionAvailable: true,
      };
    });
    return {
      info,
      switchCamera: native.flip({}).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            facing = facing === "rear" ? "front" : "rear";
            torch = false;
          })
        )
      ),
      setZoom: (level) =>
        Number.isFinite(level) && level > 0
          ? native.setZoom({ level }).pipe(Effect.asVoid)
          : Effect.fail(
              new Unavailable({ reason: "Zoom must be positive and finite" })
            ),
      setTorch: (enabled) =>
        native.setFlashMode({ flashMode: enabled ? "torch" : "off" }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              torch = enabled;
            })
          ),
          Effect.asVoid
        ),
    } satisfies VideoStreamSession;
  });
export const videoStreamLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserVideoStream>
) => effect.pipe(Effect.provide(BrowserVideoStreamLive));
