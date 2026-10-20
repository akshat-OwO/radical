import type { BridgeError } from "./bridge.ts";
import { getDeviceInfo } from "./device-info.ts";
import type { DeviceInfo } from "./device-info.ts";
import { useBridgeEffect } from "./use-bridge-effect.ts";
import type { BridgeState } from "./use-bridge-effect.ts";

export type { DeviceInfo } from "./device-info.ts";
export type { BridgeError } from "./bridge.ts";
export { RadicalProvider } from "./use-bridge-effect.ts";

export type DeviceInfoState = BridgeState<DeviceInfo, BridgeError>;

/** No browser APIs run during render. Unmount interrupts pending work. */
export const useDeviceInfo = (): DeviceInfoState =>
  useBridgeEffect(getDeviceInfo);
