import { Effect, Fiber, Stream } from "effect";
import { useContext, useEffect, useState } from "react";

import {
  networkLive,
  watchNetworkStatus,
} from "../capabilities/network/network.ts";
import type { NetworkStatus } from "../capabilities/network/network.ts";
import type { BridgeError } from "../core/bridge/bridge.ts";
import { BridgeContext } from "./use-bridge-effect.ts";
import type { BridgeState } from "./use-bridge-effect.ts";

export type NetworkStatusState = BridgeState<NetworkStatus, BridgeError>;

const initial: NetworkStatusState = {
  loading: true,
  value: undefined,
  error: undefined,
};

/** SSR stays loading. The mounted subscription owns its listener until unmount. */
export const useNetworkStatus = (): NetworkStatusState => {
  const layer = useContext(BridgeContext);

  const [snapshot, setSnapshot] = useState<{
    layer: typeof layer;
    state: NetworkStatusState;
  }>({ layer, state: initial });

  useEffect(() => {
    let live = true;

    const update = (state: NetworkStatusState) => {
      if (live) {
        setSnapshot({ layer, state });
      }
    };

    const fiber = Effect.runFork(
      networkLive(
        watchNetworkStatus.pipe(
          Stream.runForEach((value) =>
            Effect.sync(() => {
              update({ loading: false, value, error: undefined });
            })
          ),
          Effect.match({
            onSuccess: () => {
              /* Subscription completion has no additional state. */
            },
            onFailure: (error) => {
              update({ loading: false, value: undefined, error });
            },
          })
        )
      ).pipe(Effect.provide(layer))
    );

    return () => {
      live = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [layer]);

  return snapshot.layer === layer ? snapshot.state : initial;
};
