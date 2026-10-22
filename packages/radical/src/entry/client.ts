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
} from "../capabilities/transitions/browser-transitions.ts";

export type {
  BrowserTransition,
  Transition,
} from "../capabilities/transitions/browser-transitions.ts";

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
} from "../core/bridge/bridge.ts";

export type {
  BridgeError,
  InjectedBridge,
  Runtime,
} from "../core/bridge/bridge.ts";

export {
  DeviceInfoSchema,
  browserDeviceInfo,
  getDeviceInfo,
} from "../capabilities/device-info/device-info.ts";

export type { DeviceInfo } from "../capabilities/device-info/device-info.ts";

export { safeAreaStyle } from "../capabilities/safe-area/safe-area-style.ts";

export type { SafeArea } from "../core/context/native-context.ts";

export { watchSafeArea } from "../capabilities/safe-area/safe-area.ts";

export {
  NativeTransitions,
  NativeTransitionsLive,
  nativeTransition,
} from "../capabilities/transitions/native-transitions.ts";

export { TransitionTimeout } from "../capabilities/transitions/errors.ts";

export { transitionStrategy } from "../capabilities/transitions/transition-strategy.ts";

export {
  createRadicalFetch,
  localNativeContext,
  mountNativeContext,
  browserContext,
  RequestFailed,
} from "../core/bundled/bundled-request.ts";

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
} from "../capabilities/camera/camera.ts";

export type {
  Photo,
  CameraPermission,
  CameraError,
} from "../capabilities/camera/camera.ts";

export {
  pickFiles,
  filesLive,
  BrowserFiles,
  BrowserFilesLive,
} from "../capabilities/files/file-picker.ts";

export type {
  PickedFile,
  PickFilesOptions,
  FilePickerError,
} from "../capabilities/files/file-picker.ts";

export {
  openUrl,
  openFile,
  intentsLive,
  BrowserIntents,
  BrowserIntentsLive,
  NoHandler,
} from "../capabilities/files/intents.ts";

export type {
  IntentError,
  OpenableFile,
  OpenFileOptions,
} from "../capabilities/files/intents.ts";

export {
  startVideoStream,
  videoStreamLive,
  BrowserVideoStream,
  BrowserVideoStreamLive,
  VideoStreamInfoSchema,
} from "../capabilities/video-stream/video-stream.ts";

export type {
  VideoStreamInfo,
  VideoStreamOptions,
  VideoStreamSession,
  VideoStreamError,
  CameraFacing,
} from "../capabilities/video-stream/video-stream.ts";

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
} from "../capabilities/haptics/haptics.ts";

export type {
  HapticError,
  ImpactStyle,
  NotificationType,
} from "../capabilities/haptics/haptics.ts";

export {
  getNetworkStatus,
  watchNetworkStatus,
  networkLive,
  BrowserNetwork,
  BrowserNetworkLive,
  browserNetworkLayer,
  NetworkStatusSchema,
  NetworkTypeSchema,
} from "../capabilities/network/network.ts";

export type {
  NetworkStatus,
  NetworkType,
} from "../capabilities/network/network.ts";

export {
  googleSignIn,
  googleSignInLive,
  GoogleSignInConfiguration,
  GoogleSignInConfigurationLive,
  BrowserGoogleSignIn,
  BrowserGoogleSignInLive,
  GoogleIdentitySchema,
  GoogleSignInConfigSchema,
  GoogleSignInCancelled,
  GoogleSignInMisconfigured,
  GoogleSignInUnavailable,
} from "../capabilities/google-sign-in/google-sign-in.ts";

export type {
  GoogleIdentity,
  GoogleSignInConfig,
  GoogleSignInError,
} from "../capabilities/google-sign-in/google-sign-in.ts";

export {
  checkExactAlarmPermission,
  requestExactAlarmPermission,
  ExactAlarmPermissionSchema,
  NotificationScheduleResultSchema,
  NotificationScheduleWarningSchema,
  checkNotificationPermission,
  requestNotificationPermission,
  scheduleNotification,
  cancelNotification,
  registerPush,
  subscribeToTopic,
  unsubscribeFromTopic,
  getNotificationTopics,
  isSubscribedToTopic,
  setNotificationBadge,
  clearNotificationBadge,
  notificationsLive,
  BrowserNotifications,
  BrowserNotificationsLive,
  browserNotificationsLayer,
  LocalNotificationSchema,
  NotificationPermissionSchema,
  NotificationRouteSchema,
  TopicSchema,
  MissingPushConfiguration,
} from "../capabilities/notifications/notifications.ts";

export type {
  ExactAlarmPermission,
  NotificationScheduleResult,
  NotificationScheduleWarning,
  LocalNotification,
  NotificationPermission,
  NotificationError,
} from "../capabilities/notifications/notifications.ts";

export {
  NotificationSnapshots,
  NotificationSnapshotsLive,
  watchNotificationNavigation,
} from "../capabilities/notifications/notification-navigation.ts";

export {
  setDataProtection,
  clearWebData,
  dataProtectionLive,
  BrowserDataProtection,
  BrowserDataProtectionLive,
  DataProtectionStatusSchema,
  WebDataClearFailed,
} from "../capabilities/data-protection/data-protection.ts";

export type {
  DataProtectionStatus,
  DataProtectionError,
} from "../capabilities/data-protection/data-protection.ts";
