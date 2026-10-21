import { Effect, Option, Schema } from "effect";

import { Bridge } from "./bridge.ts";
import type { BridgeError } from "./bridge.ts";
import { BrowserCamera, BrowserCameraLive } from "./browser-camera.ts";
import {
  Cancelled,
  PermissionDenied,
  PhotoSchema,
  Unavailable,
} from "./camera-schema.ts";
import { cameraPlugin } from "./internal-plugins.ts";
import { callPlugin } from "./plugins.ts";

export {
  PhotoSchema,
  CameraPermissionSchema,
  PermissionDenied,
  Cancelled,
  Unavailable,
} from "./camera-schema.ts";
export type { Photo, CameraPermission } from "./camera-schema.ts";
export { BrowserCamera, BrowserCameraLive } from "./browser-camera.ts";
export type CameraError =
  | PermissionDenied
  | Cancelled
  | Unavailable
  | BridgeError;

/** Only known Capacitor Camera codes are translated. Other bridge failures survive. */
const nativeError = <A, R>(
  effect: Effect.Effect<A, BridgeError, R>
): Effect.Effect<A, CameraError, R> =>
  effect.pipe(
    Effect.catchTag(
      "BridgeCallFailed",
      (error): Effect.Effect<never, CameraError> => {
        const { cause } = error;
        const code =
          typeof cause === "object" && cause !== null && "code" in cause
            ? cause.code
            : undefined;
        if (code === "OS-PLUG-CAMR-0003" || code === "OS-PLUG-CAMR-0005") {
          return Effect.fail(new PermissionDenied({}));
        }
        if (code === "OS-PLUG-CAMR-0006" || code === "OS-PLUG-CAMR-0020") {
          return Effect.fail(new Cancelled({}));
        }
        if (code === "OS-PLUG-CAMR-0007") {
          return Effect.fail(
            new Unavailable({ reason: "No camera available" })
          );
        }
        return Effect.fail(error);
      }
    )
  );
const permission = (request: boolean) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      const browser = yield* BrowserCamera;
      return yield* request ? browser.request : browser.check;
    }
    const result = yield* request
      ? nativeError(
          callPlugin(
            cameraPlugin.bridge,
            "requestPermissions",
            cameraPlugin.commands.requestPermissions,
            { permissions: ["camera"] }
          )
        )
      : nativeError(
          callPlugin(
            cameraPlugin.bridge,
            "checkPermissions",
            cameraPlugin.commands.checkPermissions,
            {}
          )
        );
    // Android reports a first decline as prompt-with-rationale; any non-grant after a request is a denial.
    if (request && result.camera !== "granted") {
      return yield* new PermissionDenied({});
    }
    return result.camera === "prompt-with-rationale"
      ? ("prompt" as const)
      : result.camera;
  });
export const checkCameraPermission = permission(false);
export const requestCameraPermission = permission(true);

const photoEffect = (source: "camera" | "photos") =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const browser = yield* BrowserCamera;
    const runtime = yield* bridge.runtime;
    const browserPhoto = source === "camera" ? browser.capture : browser.choose;
    const blob = yield* runtime === "browser"
      ? browserPhoto
      : Effect.gen(function* () {
          const photo = yield* source === "camera"
            ? requestCameraPermission.pipe(
                Effect.andThen(
                  nativeError(
                    callPlugin(
                      cameraPlugin.bridge,
                      "takePhoto",
                      cameraPlugin.commands.takePhoto,
                      { saveToGallery: false, includeMetadata: true }
                    )
                  )
                )
              )
            : nativeError(
                callPlugin(
                  cameraPlugin.bridge,
                  "chooseFromGallery",
                  cameraPlugin.commands.chooseFromGallery,
                  {
                    mediaType: 0,
                    allowMultipleSelection: false,
                    includeMetadata: true,
                  }
                )
              ).pipe(
                Effect.flatMap(({ results }) =>
                  results.length > 0
                    ? Effect.succeed(results[0])
                    : Effect.fail(new Cancelled({}))
                )
              );
          return yield* browser.readNative(photo.uri);
        });
    const dataUrl = yield* browser.dataUrl(blob);
    // Native resolution metadata is sensor-oriented; decode instead so portrait photos report portrait sizes.
    const size = yield* browser.dimensions(blob);
    const mimeType =
      /^data:(?<mimeType>image\/[a-zA-Z0-9.+-]+);base64,/u.exec(dataUrl)?.groups
        ?.mimeType ?? "";
    return yield* Schema.decodeUnknownEffect(PhotoSchema)({
      dataUrl,
      mimeType,
      ...Option.getOrUndefined(size),
    }).pipe(
      Effect.mapError(
        () => new Unavailable({ reason: "Camera returned an invalid image" })
      )
    );
  });

export const capturePhoto = photoEffect("camera");
export const choosePhoto = photoEffect("photos");

/** Default browser service for callers that only supply a Bridge layer. */
export const cameraLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserCamera>
) => effect.pipe(Effect.provide(BrowserCameraLive));
