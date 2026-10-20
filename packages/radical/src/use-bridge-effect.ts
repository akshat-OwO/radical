import { Effect, Fiber } from "effect";
import type { Layer } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";

import { BridgeLive } from "./bridge.ts";
import type { Bridge } from "./bridge.ts";

export type BridgeState<A, E> =
  | {
      readonly loading: true;
      readonly value: undefined;
      readonly error: undefined;
    }
  | {
      readonly loading: false;
      readonly value: A;
      readonly error: undefined;
    }
  | {
      readonly loading: false;
      readonly value: undefined;
      readonly error: E;
    };

const initialState: BridgeState<never, never> = {
  loading: true,
  value: undefined,
  error: undefined,
};

const BridgeContext = createContext<Layer.Layer<Bridge>>(BridgeLive);

/** Supply one stable layer for every capability hook in this subtree. */
export const RadicalProvider = ({
  layer = BridgeLive,
  children,
}: {
  readonly layer?: Layer.Layer<Bridge>;
  readonly children?: ReactNode;
}) => createElement(BridgeContext.Provider, { value: layer }, children);

/** Effects must have stable identity. Nothing executes until React commits. */
export const useBridgeEffect = <A, E>(
  effect: Effect.Effect<A, E, Bridge>
): BridgeState<A, E> => {
  const layer = useContext(BridgeContext);
  const [snapshot, setSnapshot] = useState<{
    layer: Layer.Layer<Bridge>;
    effect: Effect.Effect<A, E, Bridge>;
    state: BridgeState<A, E>;
  }>(() => ({
    layer,
    effect,
    state: initialState,
  }));
  useEffect(() => {
    const fiber = Effect.runFork(
      effect.pipe(
        Effect.provide(layer),
        Effect.match({
          onSuccess: (value) => {
            setSnapshot({
              layer,
              effect,
              state: { loading: false, value, error: undefined },
            });
          },
          onFailure: (error) => {
            setSnapshot({
              layer,
              effect,
              state: { loading: false, value: undefined, error },
            });
          },
        })
      )
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [layer, effect]);
  return snapshot.layer === layer && snapshot.effect === effect
    ? snapshot.state
    : initialState;
};
