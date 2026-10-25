import { Effect, Fiber } from "effect";
import type { Layer } from "effect";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import type { LocationWatchPool } from "../capabilities/location/location-pool.ts";
import type { Bridge } from "../core/bridge/bridge.ts";
import { BridgeContext } from "./use-bridge-effect.ts";

export interface ActionState<A, E> {
  readonly loading: boolean;
  readonly value: A | undefined;
  readonly error: E | undefined;
}

/** One operation per hook. Ignore overlapping actions while a native UI is open. */
export const useBridgeAction = <A, E>() => {
  const layer = useContext(BridgeContext);

  const active = useRef<{
    fiber?: Fiber.Fiber<void>;
    live: boolean;
    layer?: Layer.Layer<Bridge | LocationWatchPool>;
  }>({
    live: false,
  });

  const [snapshot, setSnapshot] = useState<{
    layer: Layer.Layer<Bridge | LocationWatchPool>;
    state: ActionState<A, E>;
  }>({
    layer,
    state: { loading: false, value: undefined, error: undefined },
  });

  useEffect(() => {
    const owner: typeof active.current = { live: true, layer };
    active.current = owner;

    return () => {
      owner.live = false;

      if (owner.fiber) {
        Effect.runFork(Fiber.interrupt(owner.fiber));
      }
    };
  }, [layer]);

  const run = useCallback(
    (effect: Effect.Effect<A, E, Bridge | LocationWatchPool>) => {
      const owner = active.current;

      if (!owner.live || owner.layer !== layer || owner.fiber) {
        return;
      }

      setSnapshot({
        layer,
        state: { loading: true, value: undefined, error: undefined },
      });

      const fiber = Effect.runFork(
        effect.pipe(
          Effect.provide(layer),
          Effect.match({
            onSuccess: (value) => {
              if (owner.live) {
                setSnapshot({
                  layer,
                  state: { loading: false, value, error: undefined },
                });
              }
            },
            onFailure: (error) => {
              if (owner.live) {
                setSnapshot({
                  layer,
                  state: { loading: false, value: undefined, error },
                });
              }
            },
          })
        )
      );

      owner.fiber = fiber;
      fiber.addObserver(() => {
        owner.fiber = undefined;
      });
    },
    [layer]
  );

  const cancel = useCallback(() => {
    const owner = active.current;

    if (owner.layer === layer && owner.fiber) {
      Effect.runFork(
        Fiber.interrupt(owner.fiber).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (owner.live && active.current === owner) {
                setSnapshot({
                  layer,
                  state: { loading: false, value: undefined, error: undefined },
                });
              }
            })
          )
        )
      );
    }
  }, [layer]);

  return {
    cancel,
    ...(snapshot.layer === layer
      ? snapshot.state
      : { loading: false, value: undefined, error: undefined }),
    run,
  };
};
