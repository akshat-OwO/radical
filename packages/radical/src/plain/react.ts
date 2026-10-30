import { createElement } from "react";
import type { ReactNode, ReactElement } from "react";

import type { NativeContext } from "../core/context/native-context.ts";
import { RadicalProvider as EffectProvider } from "../react/use-bridge-effect.ts";
import type { RadicalRuntime } from "./runtime.ts";

export {
  useCamera,
  useCameraPermission,
  PermissionDenied,
  Cancelled,
  Unavailable,
  useFilePicker,
  useIntent,
  NoHandler,
  useVideoStream,
  useHapticFeedback,
  useNetworkStatus,
  useGoogleSignIn,
  GoogleSignInCancelled,
  GoogleSignInMisconfigured,
  GoogleSignInUnavailable,
  useExactAlarmPermission,
  useNotifications,
  useNotificationPermission,
  useDataProtection,
  useDeviceInfo,
  useSafeArea,
  useWindowLayout,
} from "../react/react.ts";

export type {
  DeviceInfo,
  BridgeError,
  SafeArea,
  WindowLayout,
  CameraState,
  CameraPermissionState,
  Photo,
  CameraPermission,
  CameraError,
  FilePickerState,
  IntentState,
  PickedFile,
  PickFilesOptions,
  FilePickerError,
  IntentError,
  OpenableFile,
  OpenFileOptions,
  VideoStreamState,
  VideoStreamInfo,
  VideoStreamError,
  CameraFacing,
  HapticFeedbackState,
  HapticError,
  ImpactStyle,
  NotificationType,
  NetworkStatusState,
  NetworkStatus,
  NetworkType,
  GoogleSignInState,
  GoogleIdentity,
  GoogleSignInError,
  ExactAlarmPermissionState,
  NotificationsState,
  NotificationPermissionState,
  DataProtectionState,
  DataProtectionStatus,
  DataProtectionError,
  DeviceInfoState,
} from "../react/react.ts";

export { useRadicalRuntime } from "../react/use-bridge-effect.ts";

export const RadicalProvider = (props: {
  readonly children?: ReactNode;
  readonly nativeContext?: NativeContext;
  readonly runtime?: RadicalRuntime;
}): ReactElement => createElement(EffectProvider, props);

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

export { useSections } from "../react/use-sections.ts";

export type {
  Section,
  SectionBadge,
  SectionState,
  SectionsSnapshot,
} from "../capabilities/sections/sections.ts";

export { InvalidSection } from "../capabilities/sections/sections.ts";

export {
  AppUpdateProvider,
  useAppUpdate,
  AppUpdateScreen,
  AppUpdateBoundary,
} from "../react/use-app-update.ts";

export type { AppUpdateState } from "../core/update/app-update.ts";
