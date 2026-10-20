import { Effect, Fiber } from "effect";
import type { Layer, Scope } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { BridgeLive } from "./bridge.ts";
import type { Bridge } from "./bridge.ts";
import { zeroSafeArea } from "./native-context.ts";
import type { NativeContext } from "./native-context.ts";

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

const BridgeContext = createContext<Layer.Layer<Bridge>>(BridgeLive);

/** Supply one stable layer for every capability hook in this subtree. */
export const RadicalProvider = ({
  layer = BridgeLive,
  children,
  nativeContext,
}: {
  readonly layer?: Layer.Layer<Bridge>;
  readonly children?: ReactNode;
  readonly nativeContext?: NativeContext;
}) =>
  createElement(
    BridgeContext.Provider,
    { value: layer },
    nativeContext
      ? createElement(
          NativeContextContext.Provider,
          { value: nativeContext },
          children
        )
      : children
  );

type BridgeRun<A, E> = (
  receive: (value: A) => void
) => Effect.Effect<unknown, E, Bridge | Scope.Scope>;

/** Both hook kinds share layer replacement, scoped release, and interruption. */
const useBridgeRun = <A, E>(
  run: BridgeRun<A, E>,
  initial: BridgeState<A, E>
): BridgeState<A, E> => {
  const layer = useContext(BridgeContext);
  const [snapshot, setSnapshot] = useState<{
    layer: Layer.Layer<Bridge>;
    run: BridgeRun<A, E>;
    state: BridgeState<A, E>;
  }>(() => ({ layer, run, state: initial }));
  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.scoped(
        run((value) => {
          setSnapshot({
            layer,
            run,
            state: { loading: false, value, error: undefined },
          });
        })
      ).pipe(
        Effect.provide(layer),
        Effect.match({
          onSuccess: () => {
            // Values are delivered through receive before completion.
          },
          onFailure: (error) => {
            setSnapshot({
              layer,
              run,
              state: { loading: false, value: undefined, error },
            });
          },
        })
      )
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [layer, run]);
  return snapshot.layer === layer && snapshot.run === run
    ? snapshot.state
    : initial;
};

/** Effects must have stable identity. Nothing executes until React commits. */
export const useBridgeEffect = <A, E>(
  effect: Effect.Effect<A, E, Bridge>
): BridgeState<A, E> => {
  const run = useMemo(
    () => (receive: (value: A) => void) => effect.pipe(Effect.map(receive)),
    [effect]
  );
  return useBridgeRun(run, initialState);
};

/** Subscriptions stay scoped until unmount or provider replacement. */
export const useBridgeSubscription = <A, E>(
  subscribe: BridgeRun<A, E>,
  initial: A
): BridgeState<A, E> => {
  const run = useMemo(
    () => (receive: (value: A) => void) =>
      subscribe(receive).pipe(Effect.andThen(Effect.never)),
    [subscribe]
  );
  return useBridgeRun<A, E>(run, {
    loading: false,
    value: initial,
    error: undefined,
  });
};
