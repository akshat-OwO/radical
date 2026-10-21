// oxlint-disable promise/prefer-await-to-then -- Late browser permission results must release streams even after Effect interruption.
import { Context, Effect, Layer } from "effect";

import { injectedBridge } from "./bridge.ts";
import { Cancelled, PermissionDenied, Unavailable } from "./camera-schema.ts";
import type { CameraPermission } from "./camera-schema.ts";

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
  }
>()("radical/BrowserCamera") {}

export const browserCapture = (doc: Document, camera = true) =>
  Effect.suspend(() => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (camera) {
      input.setAttribute("capture", "environment");
    }
    input.hidden = true;
    let complete:
      | ((effect: Effect.Effect<Blob, BrowserCameraError>) => void)
      | undefined;
    const change = () => {
      const file = input.files?.[0];
      complete?.(file ? Effect.succeed(file) : Effect.fail(new Cancelled({})));
    };
    const cancel = () => complete?.(Effect.fail(new Cancelled({})));
    return Effect.callback<Blob, BrowserCameraError>((receive) => {
      complete = receive;
      input.addEventListener("change", change);
      input.addEventListener("cancel", cancel);
      doc.body.append(input);
      input.click();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          input.removeEventListener("change", change);
          input.removeEventListener("cancel", cancel);
          input.remove();
        })
      )
    );
  });

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
        typeof reader.result === "string"
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

export const BrowserCameraLive = Layer.succeed(BrowserCamera, {
  capture: Effect.suspend(() =>
    typeof document === "undefined"
      ? Effect.fail(unavailable("Camera requires a browser document"))
      : browserCapture(document)
  ),
  choose: Effect.suspend(() =>
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
      typeof navigator.mediaDevices?.getUserMedia !== "function"
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
  readNative: (uri) =>
    Effect.suspend(() => {
      const convert = injectedBridge()?.convertFileSrc;
      if (typeof convert !== "function") {
        return Effect.fail(unavailable("Native file URLs require Capacitor"));
      }
      const controller = new AbortController();
      return Effect.try({ try: () => convert(uri), catch: unavailable }).pipe(
        Effect.flatMap((url) =>
          Effect.tryPromise({
            try: () => fetch(url, { signal: controller.signal }),
            catch: unavailable,
          })
        ),
        Effect.flatMap((response) =>
          response.ok
            ? Effect.tryPromise({
                try: () => response.blob(),
                catch: unavailable,
              })
            : Effect.fail(unavailable(`Photo read failed: ${response.status}`))
        ),
        Effect.ensuring(
          Effect.sync(() => {
            controller.abort();
          })
        )
      );
    }),
  dataUrl: readDataUrl,
});
