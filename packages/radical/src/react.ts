import { Effect, Fiber } from "effect";
import { useContext, useEffect, useState } from "react";

import type { BridgeError } from "./bridge.ts";
import { getDeviceInfo } from "./device-info.ts";
import type { DeviceInfo } from "./device-info.ts";
import type { SafeArea } from "./native-context.ts";
import { subscribeSafeArea } from "./safe-area.ts";
import {
  BridgeContext,
  NativeContextContext,
  useBridgeEffect,
} from "./use-bridge-effect.ts";
import type { BridgeState } from "./use-bridge-effect.ts";

export type { DeviceInfo } from "./device-info.ts";
export type { BridgeError } from "./bridge.ts";
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
export type { SafeArea } from "./native-context.ts";

export { useCamera, useCameraPermission } from "./use-camera.ts";
export type { CameraState, CameraPermissionState } from "./use-camera.ts";
export type { Photo, CameraPermission, CameraError } from "./camera.ts";
export { PermissionDenied, Cancelled, Unavailable } from "./camera-schema.ts";

export { useFilePicker, useIntent } from "./use-files.ts";
export type { FilePickerState, IntentState } from "./use-files.ts";
export type {
  PickedFile,
  PickFilesOptions,
  FilePickerError,
} from "./file-picker.ts";
export type { IntentError, OpenableFile, OpenFileOptions } from "./intents.ts";
export { NoHandler } from "./no-handler.ts";
