import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  TrackingOptions,
  TrackingSession,
} from "../capabilities/tracking-session/tracking-schema.ts";
import {
  getTrackingSession,
  startTrackingSession,
  stopTrackingSession,
  watchTrackingSession,
  newerTrackingSnapshot,
} from "../capabilities/tracking-session/tracking-session.ts";
import type { Bridge } from "../core/bridge/bridge.ts";
import { getEffectRuntime } from "../plain/runtime.ts";
import { useRadicalRuntime } from "./use-bridge-effect.ts";

export const useTrackingSession = () => {
  const runtime = useRadicalRuntime();
  const [value, setValue] = useState<TrackingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const owner = useRef({ live: false });

  const run = useCallback(
    <A, E>(
      action: Effect.Effect<A, E, Bridge>,
      receive: (value: A) => void
    ) => {
      const { current } = owner;

      return getEffectRuntime(runtime).runFork(
        action.pipe(
          Effect.match({
            onFailure: (failure) => {
              if (current.live) {
                setError(failure);
                setLoading(false);
              }
            },
            onSuccess: (result) => {
              if (current.live) {
                receive(result);
                setLoading(false);
                setError(undefined);
              }
            },
          })
        )
      );
    },
    [runtime]
  );

  const receive = useCallback((session: TrackingSession | null) => {
    setValue((current) =>
      session === null ? current : newerTrackingSnapshot(current, session)
    );
  }, []);

  const refresh = useCallback(() => {
    run(getTrackingSession, receive);
  }, [run, receive]);

  useEffect(() => {
    const current = { live: true };
    owner.current = current;

    const fiber = run(
      watchTrackingSession.pipe(
        Stream.runForEach((session) =>
          Effect.sync(() => {
            if (current.live) {
              receive(session);
              setLoading(false);
            }
          })
        )
      ),
      () => {
        /* Subscription completion has no session mutation. */
      }
    );

    return () => {
      current.live = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [run, receive]);

  return {
    value,
    loading,
    error,
    refresh,
    start: useCallback(
      (options: TrackingOptions) => {
        run(startTrackingSession(options), receive);
      },
      [run, receive]
    ),
    stop: useCallback(
      (id: string) => {
        run(stopTrackingSession(id), receive);
      },
      [run, receive]
    ),
  };
};
