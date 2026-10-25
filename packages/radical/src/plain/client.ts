import { Stream, Fiber, Effect, Schema, Result } from "effect";

import {
  capturePhoto as capturePhotoEffect,
  choosePhoto as choosePhotoEffect,
  checkCameraPermission as checkCameraPermissionEffect,
  requestCameraPermission as requestCameraPermissionEffect,
  cameraLive,
} from "../capabilities/camera/camera.ts";
import {
  setDataProtection as setDataProtectionEffect,
  clearWebData as clearWebDataEffect,
  dataProtectionLive,
} from "../capabilities/data-protection/data-protection.ts";
import {
  openAppSettings as openAppSettingsEffect,
  getDeviceInfo as getDeviceInfoEffect,
} from "../capabilities/device-info/device-info.ts";
import type { PickFilesOptions } from "../capabilities/files/file-picker.ts";
import {
  pickFiles as pickFilesEffect,
  filesLive,
} from "../capabilities/files/file-picker.ts";
import type {
  OpenableFile,
  OpenFileOptions,
} from "../capabilities/files/intents.ts";
import {
  openUrl as openUrlEffect,
  openFile as openFileEffect,
  intentsLive,
} from "../capabilities/files/intents.ts";
import {
  googleSignIn as googleSignInEffect,
  googleSignInLive,
} from "../capabilities/google-sign-in/google-sign-in.ts";
import type {
  ImpactStyle,
  NotificationType,
} from "../capabilities/haptics/haptics.ts";
import {
  hapticImpact as hapticImpactEffect,
  hapticNotification as hapticNotificationEffect,
  hapticSelection as hapticSelectionEffect,
  hapticsLive,
} from "../capabilities/haptics/haptics.ts";
import {
  watchLocationEvents as watchLocationEffect,
  locationLive,
} from "../capabilities/location/location-pool.ts";
import {
  getCurrentLocation as getCurrentLocationEffect,
  checkLocationPermission as checkLocationPermissionEffect,
  requestLocationPermission as requestLocationPermissionEffect,
  openLocationServicesSettings as openLocationServicesSettingsEffect,
} from "../capabilities/location/location.ts";
import type {
  LocationOptions,
  LocationRequestOptions,
  LocationFix,
  LocationError,
} from "../capabilities/location/location.ts";
import {
  getNetworkStatus as getNetworkStatusEffect,
  networkLive,
} from "../capabilities/network/network.ts";
import type { LocalNotification } from "../capabilities/notifications/notifications.ts";
import {
  scheduleNotification as scheduleNotificationEffect,
  cancelNotification as cancelNotificationEffect,
  subscribeToTopic as subscribeToTopicEffect,
  unsubscribeFromTopic as unsubscribeFromTopicEffect,
  isSubscribedToTopic as isSubscribedToTopicEffect,
  setNotificationBadge as setNotificationBadgeEffect,
  checkExactAlarmPermission as checkExactAlarmPermissionEffect,
  requestExactAlarmPermission as requestExactAlarmPermissionEffect,
  checkNotificationPermission as checkNotificationPermissionEffect,
  requestNotificationPermission as requestNotificationPermissionEffect,
  registerPush as registerPushEffect,
  getNotificationTopics as getNotificationTopicsEffect,
  clearNotificationBadge as clearNotificationBadgeEffect,
  notificationsLive,
  NotificationScheduleResultSchema,
} from "../capabilities/notifications/notifications.ts";
import {
  localNativeContext as localContext,
  mountNativeContext as mountContext,
} from "../core/bundled/bundled-request.ts";
import type { NativeContext } from "../core/context/native-context.ts";
import { registerOfflineEffect } from "../entry/client.ts";
import { defaultRuntime, getEffectRuntime } from "./runtime.ts";
import type { RadicalRuntime } from "./runtime.ts";

export { createRadicalRuntime } from "./runtime.ts";

export type { RadicalRuntime } from "./runtime.ts";

export { safeAreaStyle } from "../capabilities/safe-area/safe-area-style.ts";

export {
  createRadicalFetch,
  browserContext,
  RequestFailed,
} from "../core/bundled/bundled-request.ts";

export {
  ServiceWorkerRegistrationError,
  shouldRegister,
} from "../entry/client.ts";

export type {
  NativeContext,
  SafeArea,
} from "../core/context/native-context.ts";

export type {
  Runtime,
  BridgeError,
  InjectedBridge,
} from "../core/bridge/bridge.ts";

export {
  BridgeUnavailable,
  BridgeCallFailed,
  BridgeDecodeError,
} from "../core/bridge/bridge.ts";

export const registerOffline = (options: {
  readonly mode?: "remote" | "bundled";
  readonly production: boolean;
  readonly base?: string;
}): Promise<void> => Effect.runPromise(registerOfflineEffect(options));

export const localNativeContext = (): NativeContext =>
  Effect.runSync(localContext());

export const mountNativeContext = (): void => {
  Effect.runSync(mountContext());
};

export const isNotificationScheduleResult = Schema.is(
  NotificationScheduleResultSchema
);

export { detectRuntime } from "../core/bridge/bridge.ts";

export type { DeviceInfo } from "../capabilities/device-info/device-info.ts";

export const getDeviceInfo = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(getDeviceInfoEffect);

export type {
  Photo,
  CameraPermission,
  CameraError,
} from "../capabilities/camera/camera.ts";

export const capturePhoto = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(cameraLive(capturePhotoEffect));

export const choosePhoto = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(cameraLive(choosePhotoEffect));

export const checkCameraPermission = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(cameraLive(checkCameraPermissionEffect));

export const requestCameraPermission = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    cameraLive(requestCameraPermissionEffect)
  );

export type {
  PickedFile,
  PickFilesOptions,
  FilePickerError,
} from "../capabilities/files/file-picker.ts";

export const pickFiles = (
  options?: PickFilesOptions,
  runtime: RadicalRuntime = defaultRuntime
) => getEffectRuntime(runtime).runPromise(filesLive(pickFilesEffect(options)));

export type {
  IntentError,
  OpenableFile,
  OpenFileOptions,
} from "../capabilities/files/intents.ts";

export const openUrl = (
  url: string,
  runtime: RadicalRuntime = defaultRuntime
) => getEffectRuntime(runtime).runPromise(intentsLive(openUrlEffect(url)));

export const openFile = (
  file: OpenableFile,
  options?: OpenFileOptions,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    intentsLive(openFileEffect(file, options))
  );

export type {
  HapticError,
  ImpactStyle,
  NotificationType,
} from "../capabilities/haptics/haptics.ts";

export const hapticImpact = (
  style?: ImpactStyle,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(hapticsLive(hapticImpactEffect(style)));

export const hapticNotification = (
  type: NotificationType,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    hapticsLive(hapticNotificationEffect(type))
  );

export const hapticSelection = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(hapticsLive(hapticSelectionEffect));

export type {
  NetworkStatus,
  NetworkType,
} from "../capabilities/network/network.ts";

export const getNetworkStatus = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(networkLive(getNetworkStatusEffect));

export type {
  GoogleIdentity,
  GoogleSignInConfig,
  GoogleSignInError,
} from "../capabilities/google-sign-in/google-sign-in.ts";

export const googleSignIn = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(googleSignInLive(googleSignInEffect));

export type {
  ExactAlarmPermission,
  NotificationScheduleResult,
  NotificationScheduleWarning,
  LocalNotification,
  NotificationPermission,
  NotificationError,
} from "../capabilities/notifications/notifications.ts";

export const scheduleNotification = (
  options: LocalNotification,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(scheduleNotificationEffect(options))
  );

export const cancelNotification = (
  id: number,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(cancelNotificationEffect(id))
  );

export const subscribeToTopic = (
  topic: string,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(subscribeToTopicEffect(topic))
  );

export const unsubscribeFromTopic = (
  topic: string,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(unsubscribeFromTopicEffect(topic))
  );

export const isSubscribedToTopic = (
  topic: string,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(isSubscribedToTopicEffect(topic))
  );

export const setNotificationBadge = (
  count: number,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(setNotificationBadgeEffect(count))
  );

export const checkExactAlarmPermission = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(checkExactAlarmPermissionEffect)
  );

export const requestExactAlarmPermission = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(requestExactAlarmPermissionEffect)
  );

export const checkNotificationPermission = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(checkNotificationPermissionEffect)
  );

export const requestNotificationPermission = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(requestNotificationPermissionEffect)
  );

export const registerPush = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(notificationsLive(registerPushEffect));

export const getNotificationTopics = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(getNotificationTopicsEffect)
  );

export const clearNotificationBadge = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    notificationsLive(clearNotificationBadgeEffect)
  );

export type {
  DataProtectionStatus,
  DataProtectionError,
} from "../capabilities/data-protection/data-protection.ts";

export const setDataProtection = (
  enabled: boolean,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    dataProtectionLive(setDataProtectionEffect(enabled))
  );

export const clearWebData = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(dataProtectionLive(clearWebDataEffect));

export { PermissionDenied, Cancelled, Unavailable } from "../core/errors.ts";

export { NoHandler } from "../capabilities/files/errors.ts";

export { HapticFeedbackFailed } from "../capabilities/haptics/haptics.ts";

export {
  GoogleSignInCancelled,
  GoogleSignInMisconfigured,
  GoogleSignInUnavailable,
} from "../capabilities/google-sign-in/google-sign-in.ts";

export { MissingPushConfiguration } from "../capabilities/notifications/notifications.ts";

export { WebDataClearFailed } from "../capabilities/data-protection/data-protection.ts";

export type {
  LocationFix,
  LocationPermission,
  LocationOptions,
  LocationRequestOptions,
  LocationError,
} from "../capabilities/location/location.ts";

export {
  LocationServicesOff,
  LocationTimeout,
} from "../capabilities/location/location.ts";

export const getCurrentLocation = (
  options?: LocationOptions,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    locationLive(getCurrentLocationEffect(options))
  );

export const checkLocationPermission = (
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    locationLive(checkLocationPermissionEffect)
  );

export const requestLocationPermission = (
  options?: LocationRequestOptions,
  runtime: RadicalRuntime = defaultRuntime
) =>
  getEffectRuntime(runtime).runPromise(
    locationLive(requestLocationPermissionEffect(options))
  );

export const openLocationServicesSettings = (
  runtime: RadicalRuntime = defaultRuntime
) => getEffectRuntime(runtime).runPromise(openLocationServicesSettingsEffect);

export const openAppSettings = (runtime: RadicalRuntime = defaultRuntime) =>
  getEffectRuntime(runtime).runPromise(openAppSettingsEffect);

export const watchLocation = (
  receive: (fix: LocationFix) => void,
  onError: (error: LocationError) => void,
  options?: LocationOptions,
  runtime: RadicalRuntime = defaultRuntime
): (() => void) => {
  const fiber = getEffectRuntime(runtime).runFork(
    watchLocationEffect(options).pipe(
      Stream.runForEach((result) =>
        Effect.sync(() => {
          if (Result.isFailure(result)) {
            onError(result.failure);
          } else {
            receive(result.success);
          }
        })
      ),
      Effect.match({
        onFailure: onError,
        onSuccess: () => {
          /* The caller owns the subscription lifetime. */
        },
      })
    )
  );

  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
};
