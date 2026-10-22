// oxlint-disable promise/prefer-await-to-then -- Late browser permission results must release streams even after Effect interruption.
import type { Option } from "effect";
import { Context, Effect, Layer, Predicate } from "effect";

import { readNativeFile } from "../../core/native-file.ts";
import { browserFileInput } from "../files/browser-file-input.ts";
import { PermissionDenied, Unavailable } from "./camera-schema.ts";
import type { CameraPermission, Cancelled } from "./camera-schema.ts";

const supportsUserMedia = (
  devices: MediaDevices | undefined
): devices is MediaDevices => typeof devices?.getUserMedia === "function";
type BrowserCameraError = PermissionDenied | Cancelled | Unavailable;
const unavailable = (cause: unknown) =>
  new Unavailable({ reason: String(cause) });
const permissionError = (cause: unknown) =>
  cause instanceof DOMException &&
  (cause.name === "NotAllowedError" || cause.name === "SecurityError")
    ? new PermissionDenied({})
    : unavailable(cause);

/** Browser resources are isolated so tests never need a device or network. */
export class BrowserCamera extends Context.Service<
  BrowserCamera,
  {
    readonly capture: Effect.Effect<Blob, BrowserCameraError>;
    readonly choose: Effect.Effect<Blob, BrowserCameraError>;
    readonly check: Effect.Effect<CameraPermission, Unavailable>;
    readonly request: Effect.Effect<CameraPermission, BrowserCameraError>;
    readonly readNative: (uri: string) => Effect.Effect<Blob, Unavailable>;
    readonly dataUrl: (blob: Blob) => Effect.Effect<string, Unavailable>;
    /** Displayed size after EXIF orientation, or none when it cannot be decoded. */
    readonly dimensions: (
      blob: Blob
    ) => Effect.Effect<Option.Option<{ width: number; height: number }>>;
  }
>()("radical/BrowserCamera") {}

export const browserCapture = (doc: Document, camera = true) => {
  const options: CaptureInputOptions = {
    accept: "image/*",
  };
  if (camera) {
    options.capture = "environment";
  }
  return browserFileInput(doc, options).pipe(Effect.map((files) => files[0]));
};

const readDataUrl = (blob: Blob) =>
  Effect.suspend(() => {
    const reader = new FileReader();
    let complete:
      | ((effect: Effect.Effect<string, Unavailable>) => void)
      | undefined;
    const resume = (effect: Effect.Effect<string, Unavailable>) =>
      complete?.(effect);
    const load = () => {
      resume(
        Predicate.isString(reader.result)
          ? Effect.succeed(reader.result)
          : Effect.fail(unavailable("Invalid file reader result"))
      );
    };
    const error = () => {
      resume(Effect.fail(unavailable(reader.error)));
    };
    const abort = () => {
      resume(Effect.fail(unavailable("File read aborted")));
    };
    return Effect.callback<string, Unavailable>((receive) => {
      complete = receive;
      reader.addEventListener("load", load);
      reader.addEventListener("error", error);
      reader.addEventListener("abort", abort);
      reader.readAsDataURL(blob);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          reader.removeEventListener("load", load);
          reader.removeEventListener("error", error);
          reader.removeEventListener("abort", abort);
          if (reader.readyState === FileReader.LOADING) {
            reader.abort();
          }
        })
      )
    );
  });

// createImageBitmap applies EXIF orientation by default, matching how <img> renders the photo.
// A bitmap that resolves after interruption is closed in the promise continuation.
const decodedDimensions = (blob: Blob) =>
  Predicate.isFunction(globalThis.createImageBitmap)
    ? Effect.tryPromise(() =>
        createImageBitmap(blob).then((bitmap) => {
          const size = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
          return size;
        })
      ).pipe(Effect.option)
    : Effect.succeedNone;

export const BrowserCameraLive = Layer.succeed(BrowserCamera, {
  capture: Effect.suspend((): Effect.Effect<Blob, BrowserCameraError> =>
    typeof document === "undefined"
      ? Effect.fail(unavailable("Camera requires a browser document"))
      : browserCapture(document)
  ),
  choose: Effect.suspend((): Effect.Effect<Blob, BrowserCameraError> =>
    typeof document === "undefined"
      ? Effect.fail(unavailable("Photos require a browser document"))
      : browserCapture(document, false)
  ),
  check: Effect.suspend(() => {
    if (typeof navigator === "undefined") {
      return Effect.fail(unavailable("Camera requires a browser"));
    }
    if (navigator.permissions === undefined) {
      return Effect.succeed("prompt" as const);
    }
    return Effect.tryPromise({
      try: () => navigator.permissions.query({ name: "camera" }),
      catch: unavailable,
    }).pipe(
      Effect.map((status) => status.state),
      Effect.orElseSucceed(() => "prompt" as const)
    );
  }),
  request: Effect.suspend(() => {
    if (
      typeof navigator === "undefined" ||
      !supportsUserMedia(navigator.mediaDevices)
    ) {
      return Effect.fail(
        unavailable("Camera permission requests require getUserMedia")
      );
    }
    // A promise may resolve after interruption. Release its tracks in the promise
    // continuation too, rather than leaving an unobserved camera stream running.
    return Effect.tryPromise({
      try: () =>
        navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return "granted" as const;
        }),
      catch: permissionError,
    });
  }),
  readNative: readNativeFile,
  dataUrl: readDataUrl,
  dimensions: decodedDimensions,
});
interface CaptureInputOptions {
  accept: string;
  capture?: "environment";
}
