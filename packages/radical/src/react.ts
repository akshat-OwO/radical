import { Effect } from "effect";
import { useContext } from "react";

import type { BridgeError } from "./bridge.ts";
import { getDeviceInfo } from "./device-info.ts";
import type { DeviceInfo } from "./device-info.ts";
import { zeroSafeArea } from "./native-context.ts";
import type { SafeArea } from "./native-context.ts";
import { syncSafeArea } from "./safe-area.ts";
import { NativeContextContext, useBridgeEffect } from "./use-bridge-effect.ts";
import type { BridgeState } from "./use-bridge-effect.ts";

export type { DeviceInfo } from "./device-info.ts";
export type { BridgeError } from "./bridge.ts";
export { RadicalProvider } from "./use-bridge-effect.ts";

export type DeviceInfoState = BridgeState<DeviceInfo, BridgeError>;

/** No browser APIs run during render. Unmount interrupts pending work. */
export const useDeviceInfo = (): DeviceInfoState =>
  useBridgeEffect(getDeviceInfo);

const initialSafeArea = Effect.succeed(zeroSafeArea);
/** SSR and hydration use the provider context. Live updates start after commit. */
export const useSafeArea = (): SafeArea => {
  const context = useContext(NativeContextContext);
  const state = useBridgeEffect(initialSafeArea, syncSafeArea);
  return state.value ?? context.safeArea;
};
export type { SafeArea } from "./native-context.ts";
