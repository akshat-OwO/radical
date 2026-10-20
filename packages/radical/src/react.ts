import { Effect, Fiber } from "effect";
import type { Layer } from "effect";
import { useEffect, useState } from "react";

import { BridgeLive } from "./bridge.ts";
import type { Bridge, BridgeError } from "./bridge.ts";
import { getDeviceInfo } from "./device-info.ts";
import type { DeviceInfo } from "./device-info.ts";

export type { DeviceInfo } from "./device-info.ts";
export type { BridgeError } from "./bridge.ts";

export type DeviceInfoState =
  | {
      readonly loading: true;
      readonly value: undefined;
      readonly error: undefined;
    }
  | {
      readonly loading: false;
      readonly value: DeviceInfo;
      readonly error: undefined;
    }
  | {
      readonly loading: false;
      readonly value: undefined;
      readonly error: BridgeError;
    };

const initialState: DeviceInfoState = {
  loading: true,
  value: undefined,
  error: undefined,
};

/** No browser APIs run during render. Unmount interrupts work and suppresses late updates. */
export const useDeviceInfo = (
  layer: Layer.Layer<Bridge> = BridgeLive
): DeviceInfoState => {
  const [snapshot, setSnapshot] = useState<{
    layer: Layer.Layer<Bridge>;
    state: DeviceInfoState;
  }>(() => ({
    layer,
    state: initialState,
  }));
  useEffect(() => {
    const fiber = Effect.runFork(
      getDeviceInfo.pipe(
        Effect.provide(layer),
        Effect.match({
          onSuccess: (value) => {
            setSnapshot({
              layer,
              state: { loading: false, value, error: undefined },
            });
          },
          onFailure: (error) => {
            setSnapshot({
              layer,
              state: { loading: false, value: undefined, error },
            });
          },
        })
      )
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [layer]);
  return snapshot.layer === layer ? snapshot.state : initialState;
};
