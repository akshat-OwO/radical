// oxlint-disable promise/prefer-await-to-then -- Release getUserMedia results that arrive after interruption.
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";

import { PermissionDenied, Unavailable } from "./camera-schema.ts";
import type {
  VideoStreamError,
  VideoStreamOptions,
  VideoStreamSession,
} from "./video-stream-schema.ts";

export class BrowserVideoStream extends Context.Service<
  BrowserVideoStream,
  {
    readonly start: (
      options: VideoStreamOptions
    ) => Effect.Effect<VideoStreamSession, VideoStreamError, Scope.Scope>;
    readonly present: (viewfinder: HTMLElement) => Effect.Effect<() => void>;
  }
>()("radical/BrowserVideoStream") {}
const unavailable = (cause: unknown) =>
  new Unavailable({ reason: String(cause) });
const mediaError = (cause: unknown) =>
  cause instanceof DOMException &&
  (cause.name === "NotAllowedError" || cause.name === "SecurityError")
    ? new PermissionDenied({})
    : unavailable(cause);

/** The continuation also owns late results, after Effect has stopped observing the promise. */
export const requestVideoMedia = <
  A extends { getTracks: () => readonly { stop: () => void }[] },
>(
  request: () => Promise<A>,
  accept: (stream: A) => void
) =>
  Effect.tryPromise({
    try: (signal) =>
      request().then((stream) => {
        if (signal.aborted) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
        } else {
          accept(stream);
        }
      }),
    catch: mediaError,
  });

/** Only the viewfinder's ancestors become transparent. Sibling overlays stay opaque. */
export const presentVideoStream = (viewfinder: HTMLElement) =>
  Effect.sync(() => {
    const nodes: HTMLElement[] = [];
    for (
      let node: HTMLElement | null = viewfinder;
      node;
      node = node.parentElement
    ) {
      nodes.push(node);
    }
    const previous = nodes.map((node) => ({
      node,
      declarations: Array.from({ length: node.style.length }, (_, index) =>
        node.style.item(index)
      )
        .filter(
          (name) => name === "background" || name.startsWith("background-")
        )
        .map((name) => ({
          name,
          value: node.style.getPropertyValue(name),
          priority: node.style.getPropertyPriority(name),
        })),
    }));
    for (const node of nodes) {
      node.style.setProperty("background", "transparent", "important");
    }
    return () => {
      for (const { node, declarations } of previous) {
        node.style.removeProperty("background");
        for (const { name, value, priority } of declarations) {
          node.style.setProperty(name, value, priority);
        }
      }
    };
  });
interface Detector {
  readonly detect: (
    video: HTMLVideoElement
  ) => Promise<readonly { rawValue: string }[]>;
}
type DetectorConstructor = new (options: { formats: string[] }) => Detector;
const detectorConstructor = () =>
  (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor })
    .BarcodeDetector;

const browserStart = (options: VideoStreamOptions) =>
  Effect.gen(function* () {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.mediaDevices?.getUserMedia !== "function"
    ) {
      return yield* unavailable("getUserMedia is unavailable");
    }
    const video = options.viewfinder.ownerDocument.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = "width:100%;height:100%;object-fit:cover";
    let facing = options.facing ?? "rear";
    let torch = false;
    let stream: MediaStream | undefined;
    const stopTracks = () => {
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
      stream = undefined;
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        stopTracks();
        video.srcObject = null;
        video.remove();
      })
    );
    const acquire = () =>
      Effect.suspend(() => {
        let accepted = false;
        return requestVideoMedia(
          () =>
            navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: {
                  ideal: facing === "rear" ? "environment" : "user",
                },
              },
            }),
          (next) => {
            stream = next;
            accepted = true;
          }
        ).pipe(
          Effect.flatMap(() =>
            accepted
              ? Effect.sync(() => {
                  video.srcObject = stream ?? null;
                })
              : Effect.fail(unavailable("Camera acquisition was interrupted"))
          )
        );
      });
    options.viewfinder.append(video);
    yield* acquire();
    yield* Effect.tryPromise({ try: () => video.play(), catch: unavailable });
    const Constructor = detectorConstructor();
    const detector = Constructor
      ? yield* Effect.try({
          try: () => new Constructor({ formats: ["qr_code"] }),
          catch: unavailable,
        }).pipe(Effect.option)
      : undefined;
    const detection =
      detector && detector._tag === "Some" ? detector.value : undefined;
    if (detection && options.onDetect) {
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.sleep("500 millis").pipe(
            Effect.andThen(
              Effect.tryPromise({
                try: () => detection.detect(video),
                catch: unavailable,
              })
            ),
            Effect.tap((codes) =>
              Effect.sync(() => {
                for (const code of codes) {
                  options.onDetect?.(code.rawValue);
                }
              })
            ),
            Effect.ignore
          )
        )
      );
    }
    const track = () => stream?.getVideoTracks()[0];
    const info = Effect.sync(() => {
      const current = track();
      const caps:
        | (MediaTrackCapabilities & {
            zoom?: { min: number; max: number };
            torch?: boolean;
          })
        | undefined = current?.getCapabilities();
      const settings: (MediaTrackSettings & { zoom?: number }) | undefined =
        current?.getSettings();
      return {
        facing,
        torch,
        torchAvailable: caps?.torch === true,
        zoom: caps?.zoom
          ? { ...caps.zoom, current: settings?.zoom ?? caps.zoom.min }
          : undefined,
        frameRate: settings?.frameRate,
        detectionAvailable: detection !== undefined,
      };
    });
    const apply = (key: "zoom" | "torch", value: number | boolean) =>
      Effect.gen(function* () {
        const current = track();
        const state = yield* info;
        if (
          !current ||
          (key === "zoom"
            ? !state.zoom ||
              typeof value !== "number" ||
              !Number.isFinite(value) ||
              value < state.zoom.min ||
              value > state.zoom.max
            : !state.torchAvailable)
        ) {
          return yield* unavailable(
            `Camera ${key} is unsupported or out of range`
          );
        }
        return yield* Effect.tryPromise({
          try: () => current.applyConstraints({ advanced: [{ [key]: value }] }),
          catch: unavailable,
        });
      });
    return {
      info,
      switchCamera: Effect.sync(() => {
        stopTracks();
        facing = facing === "rear" ? "front" : "rear";
        torch = false;
      }).pipe(Effect.andThen(acquire)),
      setZoom: (level) => apply("zoom", level),
      setTorch: (enabled) =>
        apply("torch", enabled).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              torch = enabled;
            })
          )
        ),
    } satisfies VideoStreamSession;
  });
export const BrowserVideoStreamLive = Layer.succeed(BrowserVideoStream, {
  start: browserStart,
  present: presentVideoStream,
});
