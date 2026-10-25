import { Effect, Fiber, Semaphore, Stream } from "effect";

import { detectRuntime } from "../../core/bridge/bridge.ts";
import { defaultRuntime, getEffectRuntime } from "../../plain/runtime.ts";
import type { RadicalRuntime } from "../../plain/runtime.ts";
import { LocationPermissionEvents } from "./location-permission-events.ts";
import { locationLive, watchLocation } from "./location-pool.ts";
import {
  getCurrentLocation,
  checkLocationPermission,
  requestLocationPermission,
  PermissionDenied,
} from "./location.ts";
import type { LocationError, LocationFix } from "./location.ts";

export const positionError = (
  error: LocationError
): GeolocationPositionError => {
  let code = 2;

  if (error._tag === "PermissionDenied") {
    code = 1;
  }

  if (error._tag === "LocationTimeout") {
    code = 3;
  }

  return {
    code,
    message: error._tag,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
};

export const browserPosition = (fix: LocationFix): GeolocationPosition => {
  const { timestamp, ...fields } = fix;

  return {
    timestamp,
    coords: { ...fields, toJSON: () => fields },
    toJSON: () => ({ timestamp, coords: fields }),
  };
};

class NativePermissionStatus extends EventTarget implements PermissionStatus {
  readonly name = "geolocation";
  state: PermissionState;
  onchange: PermissionStatus["onchange"] = null;
  constructor(state: PermissionState) {
    super();
    this.state = state;
  }
  update(state: PermissionState) {
    if (state === this.state) {
      return;
    }

    this.state = state;
    const event = new Event("change");
    this.dispatchEvent(event);
    this.onchange?.(event);
  }
}

/** Install once at client startup. The returned finalizer restores the original descriptors. */
export const installNavigatorLocation = (
  target: Pick<Navigator, "geolocation" | "permissions">,
  runtime: RadicalRuntime = defaultRuntime
) =>
  Effect.gen(function* () {
    const managed = getEffectRuntime(runtime);
    const semaphore = yield* Semaphore.make(1);
    const watches = new Map<number, Fiber.Fiber<void>>();
    const pending = new Set<Fiber.Fiber<void>>();
    let status: NativePermissionStatus | undefined;
    let nextId = 0;
    let active = true;
    const originalGeo = Object.getOwnPropertyDescriptor(target, "geolocation");

    const originalQuery = Object.getOwnPropertyDescriptor(
      target.permissions,
      "query"
    );

    const query = target.permissions.query.bind(target.permissions);

    const update = (state: PermissionState) => {
      status?.update(state);
    };

    const ensurePermission = semaphore.withPermit(
      locationLive(
        Effect.gen(function* () {
          let permission = yield* checkLocationPermission;

          if (permission.state === "prompt") {
            permission = yield* requestLocationPermission();
          }

          update(permission.state);

          if (permission.state !== "granted") {
            return yield* new PermissionDenied({});
          }

          return permission;
        })
      )
    );

    const failure =
      (receive: PositionErrorCallback | null | undefined) =>
      (error: LocationError) => {
        if (active) {
          receive?.(positionError(error));
        }
      };

    let permissionFiber: Fiber.Fiber<void> | undefined;

    const subscribePermission = () => {
      permissionFiber ??= managed.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const events = yield* LocationPermissionEvents;
            yield* events.listen((permission) => {
              if (active) {
                update(permission.state);
              }
            });

            return yield* Effect.never;
          })
        )
      );
    };

    const geolocation: Geolocation = {
      getCurrentPosition: (success, onError, options) => {
        const fiber = managed.runFork(
          ensurePermission.pipe(
            Effect.andThen(locationLive(getCurrentLocation(options))),
            Effect.match({
              onSuccess: (fix) => {
                if (active) {
                  success(browserPosition(fix));
                }
              },
              onFailure: failure(onError),
            })
          )
        );

        pending.add(fiber);
        fiber.addObserver(() => {
          pending.delete(fiber);
        });
      },
      watchPosition: (success, onError, options) => {
        nextId += 1;
        const id = nextId;

        const fiber = managed.runFork(
          ensurePermission.pipe(
            Effect.andThen(
              watchLocation(options).pipe(
                Stream.runForEach((fix) =>
                  Effect.sync(() => {
                    if (active) {
                      success(browserPosition(fix));
                    }
                  })
                )
              )
            ),
            Effect.match({
              onFailure: failure(onError),
              onSuccess: () => {
                /* A watch ends only when its owner releases it. */
              },
            }),
            Effect.ensuring(
              Effect.sync(() => {
                watches.delete(id);
              })
            )
          )
        );

        watches.set(id, fiber);
        pending.add(fiber);
        fiber.addObserver(() => {
          watches.delete(id);
          pending.delete(fiber);
        });

        return id;
      },
      clearWatch: (id) => {
        const fiber = watches.get(id);

        if (fiber) {
          watches.delete(id);
          Effect.runFork(Fiber.interrupt(fiber));
        }
      },
    };

    Object.defineProperty(target, "geolocation", {
      configurable: true,
      value: geolocation,
    });
    Object.defineProperty(target.permissions, "query", {
      configurable: true,
      value: (descriptor: PermissionDescriptor): Promise<PermissionStatus> => {
        if (descriptor.name !== "geolocation") {
          return query(descriptor);
        }

        subscribePermission();

        return managed.runPromise(
          locationLive(checkLocationPermission).pipe(
            Effect.map((permission) => {
              update(permission.state);
              status ??= new NativePermissionStatus(permission.state);

              return status;
            })
          )
        );
      },
    });

    return Effect.gen(function* () {
      active = false;

      if (permissionFiber) {
        yield* Fiber.interrupt(permissionFiber);
      }

      yield* Effect.forEach(pending, Fiber.interrupt, {
        concurrency: "unbounded",
      });
      watches.clear();
      pending.clear();
      status = undefined;

      if (originalGeo) {
        Object.defineProperty(target, "geolocation", originalGeo);
      } else {
        Reflect.deleteProperty(target, "geolocation");
      }

      if (originalQuery) {
        Object.defineProperty(target.permissions, "query", originalQuery);
      } else {
        Reflect.deleteProperty(target.permissions, "query");
      }
    });
  });

declare const __RADICAL_LOCATION__: {
  readonly replaceNavigator?: boolean;
} | null;

export const installLocationClient = Effect.suspend(() => {
  if (
    // oxlint-disable-next-line unicorn/no-typeof-undefined -- Vite replaces this symbol; source imports must remain SSR safe.
    typeof __RADICAL_LOCATION__ === "undefined" ||
    __RADICAL_LOCATION__ === null ||
    __RADICAL_LOCATION__.replaceNavigator === false ||
    typeof navigator === "undefined" ||
    detectRuntime() === "browser"
  ) {
    return Effect.void;
  }

  return installNavigatorLocation(navigator).pipe(Effect.asVoid);
});
