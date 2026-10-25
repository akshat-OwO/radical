import { Effect, Fiber } from "effect";
import { useContext, useEffect, useState } from "react";

import { getDeviceInfo } from "../capabilities/device-info/device-info.ts";
import type { DeviceInfo } from "../capabilities/device-info/device-info.ts";
import { subscribeSafeArea } from "../capabilities/safe-area/safe-area.ts";
import { subscribeWindowLayout } from "../capabilities/window-layout/window-layout.ts";
import type { BridgeError } from "../core/bridge/bridge.ts";
import type { WindowLayout, SafeArea } from "../core/context/native-context.ts";
import {
  BridgeContext,
  NativeContextContext,
  useBridgeEffect,
} from "./use-bridge-effect.ts";
import type { BridgeState } from "./use-bridge-effect.ts";

export type { DeviceInfo } from "../capabilities/device-info/device-info.ts";

export type { BridgeError } from "../core/bridge/bridge.ts";

export { RadicalProvider } from "./use-bridge-effect.ts";

export type DeviceInfoState = BridgeState<DeviceInfo, BridgeError>;

/** No browser APIs run during render. Unmount interrupts pending work. */
export const useDeviceInfo = (): DeviceInfoState =>
  useBridgeEffect(getDeviceInfo);

/** SSR and hydration use the provider context. Live updates start after commit. */
export const useSafeArea = (): SafeArea => {
  const context = useContext(NativeContextContext);
  const layer = useContext(BridgeContext);
  const [snapshot, setSnapshot] = useState({ layer, area: context.safeArea });
  useEffect(() => {
    let release: (() => void) | undefined;

    const fiber = Effect.runFork(
      subscribeSafeArea((area) => {
        setSnapshot({ layer, area });
      }).pipe(
        Effect.map((remove) => {
          release = remove;

          return remove;
        }),
        Effect.andThen(Effect.never),
        Effect.provide(layer)
      )
    );

    return () => {
      release?.();
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [layer]);

  return snapshot.layer === layer ? snapshot.area : context.safeArea;
};

/** SSR and hydration use the provider context. Live updates start after commit. */
export const useWindowLayout = (): WindowLayout => {
  const context = useContext(NativeContextContext);
  const layer = useContext(BridgeContext);

  const [snapshot, setSnapshot] = useState({
    layer,
    layout: context.windowLayout,
  });

  useEffect(() => {
    let release: (() => void) | undefined;

    const fiber = Effect.runFork(
      subscribeWindowLayout((layout) => {
        setSnapshot({ layer, layout });
      }).pipe(
        Effect.map((remove) => {
          release = remove;

          return remove;
        }),
        Effect.andThen(Effect.never),
        Effect.provide(layer)
      )
    );

    return () => {
      release?.();
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [layer]);

  return snapshot.layer === layer ? snapshot.layout : context.windowLayout;
};

export type { SafeArea } from "../core/context/native-context.ts";

export { useCamera, useCameraPermission } from "./use-camera.ts";

export type { CameraState, CameraPermissionState } from "./use-camera.ts";

export type {
  Photo,
  CameraPermission,
  CameraError,
} from "../capabilities/camera/camera.ts";

export { PermissionDenied, Cancelled, Unavailable } from "../core/errors.ts";

export { useFilePicker, useIntent } from "./use-files.ts";

export type { FilePickerState, IntentState } from "./use-files.ts";

export type {
  PickedFile,
  PickFilesOptions,
  FilePickerError,
} from "../capabilities/files/file-picker.ts";

export type {
  IntentError,
  OpenableFile,
  OpenFileOptions,
} from "../capabilities/files/intents.ts";

export { NoHandler } from "../capabilities/files/errors.ts";

export { useVideoStream } from "./use-video-stream.ts";

export type { VideoStreamState } from "./use-video-stream.ts";

export type {
  VideoStreamInfo,
  VideoStreamError,
  CameraFacing,
} from "../capabilities/video-stream/video-stream.ts";

export { useHapticFeedback } from "./use-haptic-feedback.ts";

export type { HapticFeedbackState } from "./use-haptic-feedback.ts";

export type {
  HapticError,
  ImpactStyle,
  NotificationType,
} from "../capabilities/haptics/haptics.ts";

export { useNetworkStatus } from "./use-network-status.ts";

export type { NetworkStatusState } from "./use-network-status.ts";

export type {
  NetworkStatus,
  NetworkType,
} from "../capabilities/network/network.ts";

export { useGoogleSignIn } from "./use-google-sign-in.ts";

export type { GoogleSignInState } from "./use-google-sign-in.ts";

export type {
  GoogleIdentity,
  GoogleSignInError,
} from "../capabilities/google-sign-in/google-sign-in.ts";

export { GoogleSignInCancelled } from "../capabilities/google-sign-in/errors.ts";

export { GoogleSignInMisconfigured } from "../capabilities/google-sign-in/errors.ts";

export { GoogleSignInUnavailable } from "../capabilities/google-sign-in/errors.ts";

export {
  useExactAlarmPermission,
  useNotifications,
  useNotificationPermission,
} from "./use-notifications.ts";

export type {
  ExactAlarmPermissionState,
  NotificationsState,
  NotificationPermissionState,
} from "./use-notifications.ts";

export { useDataProtection } from "./use-data-protection.ts";

export type { DataProtectionState } from "./use-data-protection.ts";

export type {
  DataProtectionStatus,
  DataProtectionError,
} from "../capabilities/data-protection/data-protection.ts";

export {
  useLocation,
  useLocationPermission,
  useLocationWatch,
} from "../react/use-location.ts";

export type {
  LocationState,
  LocationPermissionState,
  LocationWatchState,
} from "../react/use-location.ts";

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

export type { WindowLayout } from "../core/context/native-context.ts";

export { useSections } from "./use-sections.ts";

export type {
  Section,
  SectionBadge,
  SectionState,
  SectionsSnapshot,
} from "../capabilities/sections/sections.ts";

export { InvalidSection } from "../capabilities/sections/sections.ts";
