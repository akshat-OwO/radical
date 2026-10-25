import { Effect, Fiber, Stream, Result } from "effect";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { LocationPermissionEvents } from "../capabilities/location/location-permission-events.ts";
import {
  locationLive,
  watchLocationEvents,
} from "../capabilities/location/location-pool.ts";
import {
  getCurrentLocation,
  checkLocationPermission,
  requestLocationPermission,
} from "../capabilities/location/location.ts";
import type {
  LocationError,
  LocationFix,
  LocationOptions,
  LocationPermission,
  LocationRequestOptions,
} from "../capabilities/location/location.ts";
import { getEffectRuntime } from "../plain/runtime.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import type { ActionState } from "./use-bridge-action.ts";
import { useRadicalRuntime, BridgeContext } from "./use-bridge-effect.ts";

export interface LocationState extends ActionState<LocationFix, LocationError> {
  readonly getCurrent: (options?: LocationOptions) => void;
}

export interface LocationPermissionState extends ActionState<
  LocationPermission,
  LocationError
> {
  readonly check: () => void;
  readonly request: (options?: LocationRequestOptions) => void;
}

export interface LocationWatchState extends ActionState<
  LocationFix,
  LocationError
> {
  readonly running: boolean;
  readonly start: (options?: LocationOptions) => void;
  readonly stop: () => void;
}

export const useLocation = (): LocationState => {
  const { run, ...state } = useBridgeAction<LocationFix, LocationError>();

  return {
    ...state,
    getCurrent: useCallback(
      (options) => {
        run(locationLive(getCurrentLocation(options)));
      },
      [run]
    ),
  };
};

const observeLocationPermission = (
  receive: (permission: LocationPermission) => void
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* LocationPermissionEvents;
      yield* events.listen(receive);

      return yield* Effect.never;
    })
  );

export const useLocationPermission = (): LocationPermissionState => {
  const layer = useContext(BridgeContext);
  const runtime = useRadicalRuntime();

  const [external, setExternal] = useState<{
    layer: typeof layer;
    value: LocationPermission;
  }>();

  const { run, ...state } = useBridgeAction<
    LocationPermission,
    LocationError
  >();

  useEffect(() => {
    let live = true;

    const fiber = getEffectRuntime(runtime).runFork(
      observeLocationPermission((value) => {
        if (live) {
          setExternal({ layer, value });
        }
      })
    );

    return () => {
      live = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [layer, runtime]);

  const check = useCallback(() => {
    run(
      Effect.sync(() => {
        setExternal(undefined);
      }).pipe(Effect.andThen(locationLive(checkLocationPermission)))
    );
  }, [run]);

  useEffect(check, [check]);

  return {
    ...(external?.layer === layer
      ? { loading: false, value: external.value, error: undefined }
      : state),
    check,
    request: useCallback(
      (options) => {
        run(
          Effect.sync(() => {
            setExternal(undefined);
          }).pipe(
            Effect.andThen(locationLive(requestLocationPermission(options)))
          )
        );
      },
      [run]
    ),
  };
};

export const useLocationWatch = (): LocationWatchState => {
  const layer = useContext(BridgeContext);

  const { run, cancel, loading, error } = useBridgeAction<
    undefined,
    LocationError
  >();

  const [snapshot, setSnapshot] = useState<{
    layer: typeof layer;
    fix: LocationFix | undefined;
    error: LocationError | undefined;
  }>();

  const owner = useRef({ layer, live: false });
  useEffect(() => {
    const current = { layer, live: true };
    owner.current = current;

    return () => {
      current.live = false;
    };
  }, [layer]);

  return {
    loading: loading && snapshot?.layer !== layer,
    running: loading,
    value: loading && snapshot?.layer === layer ? snapshot.fix : undefined,
    error:
      error ??
      (loading && snapshot?.layer === layer ? snapshot.error : undefined),
    start: useCallback(
      (options) => {
        const { current } = owner;

        if (!current.live || current.layer !== layer) {
          return;
        }

        run(
          Effect.sync(() => {
            setSnapshot(undefined);
          }).pipe(
            Effect.andThen(
              watchLocationEvents(options).pipe(
                Stream.runForEach((result) =>
                  Effect.sync(() => {
                    if (current.live) {
                      setSnapshot((previous) => {
                        if (Result.isSuccess(result)) {
                          return {
                            layer,
                            fix: result.success,
                            error: undefined,
                          };
                        }

                        return {
                          layer,
                          fix:
                            previous?.layer === layer
                              ? previous.fix
                              : undefined,
                          error: result.failure,
                        };
                      });
                    }
                  })
                ),
                Effect.andThen(Effect.never)
              )
            )
          )
        );
      },
      [run, layer]
    ),
    stop: cancel,
  };
};
