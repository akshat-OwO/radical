import { useCallback, useEffect } from "react";

import {
  cameraLive,
  capturePhoto,
  choosePhoto,
  checkCameraPermission,
  requestCameraPermission,
} from "./camera.ts";
import type { CameraError, CameraPermission, Photo } from "./camera.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import type { ActionState } from "./use-bridge-action.ts";

const capture = cameraLive(capturePhoto);
const choose = cameraLive(choosePhoto);
const check = cameraLive(checkCameraPermission);
const request = cameraLive(requestCameraPermission);
export interface CameraState extends ActionState<Photo, CameraError> {
  readonly capture: () => void;
  readonly choose: () => void;
}
export interface CameraPermissionState extends ActionState<
  CameraPermission,
  CameraError
> {
  readonly check: () => void;
  readonly request: () => void;
}
export const useCamera = (): CameraState => {
  const { run, ...state } = useBridgeAction<Photo, CameraError>();
  return {
    ...state,
    choose: useCallback(() => {
      run(choose);
    }, [run]),
    capture: useCallback(() => {
      run(capture);
    }, [run]),
  };
};
/** Checks after commit. Permission requests only run from an explicit action. */
export const useCameraPermission = (): CameraPermissionState => {
  const { run, ...state } = useBridgeAction<CameraPermission, CameraError>();
  const refresh = useCallback(() => {
    run(check);
  }, [run]);
  useEffect(refresh, [refresh]);
  return {
    ...state,
    check: refresh,
    request: useCallback(() => {
      run(request);
    }, [run]),
  };
};
