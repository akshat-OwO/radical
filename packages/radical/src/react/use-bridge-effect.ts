import { Effect, Fiber } from "effect";
import type { Layer } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { zeroSafeArea } from "../capabilities/safe-area/safe-area-style.ts";
import { BridgeLive } from "../core/bridge/bridge.ts";
import type { Bridge } from "../core/bridge/bridge.ts";
import type { NativeContext } from "../core/context/native-context.ts";
import {
  createEffectRuntime,
  defaultRuntime,
  runtimeBridgeLayer,
} from "../plain/runtime.ts";
import type { RadicalRuntime } from "../plain/runtime.ts";

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

export const NativeContextContext = createContext<NativeContext>({
  platform: "browser",
  safeArea: zeroSafeArea,
  shellVersion: null,
});

export const RuntimeContext = createContext<RadicalRuntime>(defaultRuntime);

export const BridgeContext = createContext<Layer.Layer<Bridge>>(BridgeLive);

const runtimeOwner = (
  layer: Layer.Layer<Bridge>,
  supplied?: RadicalRuntime
) => {
  let runtime = supplied ?? createEffectRuntime(layer);
  let disposed = false;
  const listeners = new Set<() => void>();

  return {
    snapshot: () => runtime,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    setup: () => {
      if (disposed) {
        runtime = createEffectRuntime(layer);
        disposed = false;

        for (const listener of listeners) {
          listener();
        }
      }

      const owned = runtime;

      return () => {
        if (!supplied) {
          disposed = true;
          void owned.dispose();
        }
      };
    },
  };
};

/** Effect API provider accepts an injectable bridge layer. */
export const RadicalProvider = ({
  layer = BridgeLive,
  children,
  nativeContext,
  runtime: supplied,
}: {
  readonly layer?: Layer.Layer<Bridge>;
  readonly runtime?: RadicalRuntime;
  readonly children?: ReactNode;
  readonly nativeContext?: NativeContext;
}) => {
  const owner = useMemo(() => runtimeOwner(layer, supplied), [layer, supplied]);

  const runtime = useSyncExternalStore(
    owner.subscribe,
    owner.snapshot,
    owner.snapshot
  );

  useEffect(() => owner.setup(), [owner]);

  const bridge = useMemo(() => runtimeBridgeLayer(runtime), [runtime]);

  return createElement(
    RuntimeContext.Provider,
    { value: runtime },
    createElement(
      BridgeContext.Provider,
      { value: bridge },
      nativeContext
        ? createElement(
            NativeContextContext.Provider,
            { value: nativeContext },
            children
          )
        : children
    )
  );
};

export const useRadicalRuntime = (): RadicalRuntime =>
  useContext(RuntimeContext);

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
