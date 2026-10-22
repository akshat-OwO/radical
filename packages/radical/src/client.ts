import { Effect, Schema } from "effect";

export const shouldRegister = (context: {
  readonly production: boolean;
  readonly browser: boolean;
}) => context.production && context.browser;

export class ServiceWorkerRegistrationError extends Schema.TaggedError<
  ServiceWorkerRegistrationError,
  { readonly brand: unique symbol }
>()("ServiceWorkerRegistrationError", { cause: Schema.Unknown }) {}

export const registerOfflineEffect = (options: {
  readonly mode?: "remote" | "bundled";
  readonly production: boolean;
  readonly base?: string;
}) =>
  Effect.suspend(() => {
    const browser =
      typeof window !== "undefined" && typeof navigator !== "undefined";
    if (
      options.mode === "bundled" ||
      !shouldRegister({
        production: options.production,
        browser,
      }) ||
      !("serviceWorker" in navigator)
    ) {
      return Effect.void;
    }
    const base = options.base ?? "/";
    return Effect.tryPromise({
      try: () =>
        navigator.serviceWorker.register(`${base}radical-sw.js`, {
          scope: base,
        }),
      catch: (cause) => new ServiceWorkerRegistrationError({ cause }),
    }).pipe(Effect.asVoid);
  });

/** Promise facade for app lifecycle hooks; Effect remains available separately. */
export const registerOffline = (
  options: Parameters<typeof registerOfflineEffect>[0]
) => Effect.runPromise(registerOfflineEffect(options));

export {
  BrowserTransitions,
  BrowserTransitionsLive,
  cancelBrowserTransition,
  watchBrowserTransition,
  TransitionSchema,
  TransitionFailed,
} from "./browser-transitions.ts";
export type { BrowserTransition, Transition } from "./browser-transitions.ts";

export {
  Bridge,
  BridgeLive,
  bridgeLayer,
  bridgeTestLayer,
  callBridge,
  detectRuntime,
  RuntimeSchema,
  BridgeUnavailable,
  BridgeCallFailed,
  BridgeDecodeError,
} from "./bridge.ts";
export type { BridgeError, InjectedBridge, Runtime } from "./bridge.ts";
export {
  DeviceInfoSchema,
  browserDeviceInfo,
  getDeviceInfo,
} from "./device-info.ts";
export type { DeviceInfo } from "./device-info.ts";

export { safeAreaStyle } from "./safe-area-style.ts";
export type { SafeArea } from "./native-context.ts";
export { watchSafeArea } from "./safe-area.ts";

export {
  NativeTransitions,
  NativeTransitionsLive,
  nativeTransition,
} from "./native-transitions.ts";

export { TransitionTimeout } from "./transition-timeout.ts";

export { transitionStrategy } from "./transition-strategy.ts";

export {
  createRadicalFetch,
  localNativeContext,
  mountNativeContext,
  browserContext,
  RequestFailed,
} from "./bundled-request.ts";

export {
  capturePhoto,
  choosePhoto,
  checkCameraPermission,
  requestCameraPermission,
  cameraLive,
  BrowserCamera,
  BrowserCameraLive,
  PhotoSchema,
  CameraPermissionSchema,
  PermissionDenied,
  Cancelled,
  Unavailable,
} from "./camera.ts";
export type { Photo, CameraPermission, CameraError } from "./camera.ts";

export {
  pickFiles,
  filesLive,
  BrowserFiles,
  BrowserFilesLive,
} from "./file-picker.ts";
export type {
  PickedFile,
  PickFilesOptions,
  FilePickerError,
} from "./file-picker.ts";
export {
  openUrl,
  openFile,
  intentsLive,
  BrowserIntents,
  BrowserIntentsLive,
  NoHandler,
} from "./intents.ts";
export type { IntentError, OpenableFile, OpenFileOptions } from "./intents.ts";

export {
  startVideoStream,
  videoStreamLive,
  BrowserVideoStream,
  BrowserVideoStreamLive,
  VideoStreamInfoSchema,
} from "./video-stream.ts";
export type {
  VideoStreamInfo,
  VideoStreamOptions,
  VideoStreamSession,
  VideoStreamError,
  CameraFacing,
} from "./video-stream.ts";

export {
  hapticImpact,
  hapticNotification,
  hapticSelection,
  hapticsLive,
  BrowserHaptics,
  BrowserHapticsLive,
  HapticFeedbackFailed,
  ImpactStyleSchema,
  NotificationTypeSchema,
} from "./haptics.ts";
export type { HapticError, ImpactStyle, NotificationType } from "./haptics.ts";
