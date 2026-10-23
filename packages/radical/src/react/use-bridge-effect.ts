import { Effect, Fiber } from "effect";
import type { Layer } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useMemo,
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
  const runtime = useMemo(
    () => supplied ?? createEffectRuntime(layer),
    [supplied, layer]
  );

  const bridge = useMemo(() => runtimeBridgeLayer(runtime), [runtime]);

  const ownership = useMemo<{
    readonly runtime: RadicalRuntime;
    pending?: Fiber.Fiber<void>;
  }>(() => ({ runtime }), [runtime]);

  useEffect(() => {
    if (ownership.pending) {
      Effect.runFork(Fiber.interrupt(ownership.pending));
    }

    return () => {
      if (!supplied) {
        // React StrictMode replays setup after cleanup in the same commit.
        // Yield once so that replay can retain the owner before final disposal.
        ownership.pending = Effect.runFork(
          Effect.yieldNow.pipe(
            Effect.andThen(Effect.promise(ownership.runtime.dispose))
          )
        );
      }
    };
  }, [ownership, supplied]);

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
