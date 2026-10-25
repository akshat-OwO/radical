// oxlint-disable anti-slop/no-unknown-parameters -- The test bridge deliberately accepts malformed native callback payloads.
import { Clock, Effect, Layer, Queue, Schema } from "effect";

import {
  Bridge,
  BridgeCallFailed,
  BridgeDecodeError,
} from "../../../src/core/bridge/bridge.ts";
import type { BridgeError } from "../../../src/core/bridge/bridge.ts";

export const fix = {
  coords: { latitude: 51, longitude: -1, accuracy: 12 },
  timestamp: 100,
};

// Capacitor 8.2.4 forwards CoreLocation's invalid-measurement sentinels unchanged.
export const iosSimulatorFix = {
  timestamp: 100,
  coords: {
    altitude: 0,
    heading: null,
    magneticHeading: null,
    trueHeading: null,
    headingAccuracy: null,
    course: null,
    accuracy: 12,
    latitude: 51,
    longitude: -1,
    speed: -1,
    altitudeAccuracy: -1,
  },
} as const;

// iongeolocation-android 2.2.2 drops hasSpeed/hasAltitude/hasVerticalAccuracy.
// Their getters return zero when absent, indistinguishable from valid zero readings.
export const androidFix = {
  timestamp: 100,
  coords: {
    altitude: 0,
    heading: null,
    magneticHeading: null,
    trueHeading: null,
    headingAccuracy: null,
    course: null,
    accuracy: 12,
    latitude: 51,
    longitude: -1,
    speed: 0,
    altitudeAccuracy: 0,
  },
} as const;

export const locationFixture = (platform: "ios" | "android" = "android") =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const nativeFix = platform === "ios" ? iosSimulatorFix : androidFix;
    const starts = yield* Queue.unbounded<number>();
    const releases = yield* Queue.unbounded<number>();
    const activityStarts = yield* Queue.unbounded<number>();
    const activityReleases = yield* Queue.unbounded<number>();
    let activityStarted = 0;
    let activityReleased = 0;
    let count = 0;
    let released = 0;

    const subscriptions = new Map<
      number,
      {
        receive: (value: unknown, error?: BridgeError) => void;
        hasFix: boolean;
      }
    >();

    const activity = new Set<(value: unknown) => void>();

    const calls: {
      method: string;
      plugin: string;
      options: Parameters<Bridge["Service"]["call"]>[2];
    }[] = [];

    const control = {
      requestGranted: true,
      timestamp: 100,
      androidApiLevel: 36,
      playServicesAvailable: true,
      servicesEnabled: true,
      emitInitialFix: true,
      watchError: "",
    };

    const state = {
      location: "prompt",
      coarseLocation: "prompt",
      precision: "approximate",
    };

    const applyPermissionRequest = (
      options: Parameters<Bridge["Service"]["call"]>[2]
    ) => {
      state.coarseLocation = control.requestGranted ? "granted" : "denied";

      if (
        control.requestGranted &&
        Array.isArray(options.permissions) &&
        options.permissions.includes("location")
      ) {
        state.location = "granted";
      } else if (!control.requestGranted || state.location !== "granted") {
        state.location = "denied";
      }
    };

    const fail = (code: string, onlyId?: number) => {
      for (const [id, subscription] of subscriptions) {
        if (
          onlyId !== undefined &&
          id !== onlyId &&
          !(platform === "ios" && code === "OS-PLUG-GLOC-0010")
        ) {
          continue;
        }

        subscription.receive(
          undefined,
          new BridgeCallFailed({
            plugin: "Geolocation",
            method: "watchPosition",
            cause: { code },
          })
        );

        // iOS clears every watch callback on timeout. Android cancels its
        // timed-out flow, and setup failures may install no location handler.
        if (
          code === "OS-PLUG-GLOC-0010" ||
          (platform === "android" && !subscription.hasFix)
        ) {
          subscriptions.delete(id);
        }
      }
    };

    const layer = Layer.succeed(Bridge, {
      runtime: Effect.succeed(platform),
      observe: () =>
        Effect.succeed(() => {
          /* No retained shell events in this fixture. */
        }),
      call: (plugin, method, options) =>
        Effect.gen(function* () {
          calls.push({ plugin, method, options });

          if (!control.servicesEnabled && plugin === "Geolocation") {
            return yield* new BridgeCallFailed({
              plugin,
              method,
              cause: { code: "OS-PLUG-GLOC-0007" },
            });
          }

          if (
            method === "accuracyAuthorization" ||
            method === "requestTemporaryFullAccuracy"
          ) {
            return { precision: state.precision };
          }

          if (method === "playServicesAvailability") {
            return { available: control.playServicesAvailable };
          }

          if (method === "getCurrentPosition") {
            // Upstream selects its FINE alias before API 31; the platform grants
            // it without another prompt when this permission group is already allowed.
            if (
              platform === "android" &&
              control.androidApiLevel < 31 &&
              state.coarseLocation === "granted"
            ) {
              state.location = "granted";
            }

            state.coarseLocation = "granted";

            return { ...nativeFix, timestamp: control.timestamp };
          }

          // CoreLocation reports globally disabled services as denied authorization.
          if (
            platform === "ios" &&
            !control.servicesEnabled &&
            (method === "checkPermissions" || method === "requestPermissions")
          ) {
            return { location: "denied", coarseLocation: "denied" };
          }

          if (method === "requestPermissions") {
            applyPermissionRequest(options);
          }

          return { ...state };
        }),
      listen: (_plugin, _event, receiveNative) =>
        Effect.sync(() => {
          activity.add(receiveNative);
          activityStarted += 1;
          Queue.offerUnsafe(activityStarts, activityStarted);

          return Effect.sync(() => {
            activity.delete(receiveNative);
            activityReleased += 1;
            Queue.offerUnsafe(activityReleases, activityReleased);
          });
        }),
      subscribe: (_plugin, _method, _options, schema, receiveNative) =>
        Effect.sync(() => {
          count += 1;
          state.coarseLocation = "granted";
          calls.push({
            plugin: _plugin,
            method: "watchPosition",
            options: _options,
          });
          const id = count;

          const subscription = {
            hasFix: false,
            receive: (value: unknown, error?: BridgeError) => {
              if (error === undefined) {
                subscription.hasFix = true;
              }

              receiveNative(
                error
                  ? Effect.fail(error)
                  : Schema.decodeUnknownEffect(schema)(value).pipe(
                      Effect.mapError(
                        (cause) =>
                          new BridgeDecodeError({
                            plugin: "Geolocation",
                            method: "watchPosition",
                            cause,
                          })
                      )
                    )
              );
            },
          };

          subscriptions.set(id, subscription);
          Queue.offerUnsafe(starts, count);

          if (control.watchError !== "") {
            fail(control.watchError, id);
          } else if (!control.servicesEnabled) {
            fail("OS-PLUG-GLOC-0007", id);
          } else if (control.emitInitialFix) {
            subscription.receive({
              ...nativeFix,
              timestamp: control.timestamp,
            });
          }

          return Effect.sync(() => {
            released += 1;
            subscriptions.delete(id);
            Queue.offerUnsafe(releases, released);
          });
        }),
    });

    return {
      layer: Layer.merge(layer, Layer.succeed(Clock.Clock, clock)),
      control,
      calls,
      state,
      starts,
      releases,
      activityStarts,
      activityReleases,
      activityListeners: () => activity.size,
      activityStarted: () => activityStarted,
      count: () => count,
      released: () => released,
      emit: (value: unknown) => {
        for (const subscription of subscriptions.values()) {
          subscription.receive(value);
        }
      },
      liveSubscriptions: () => subscriptions.size,
      fail,
      active: (active: boolean) => {
        for (const receiveActivity of activity) {
          receiveActivity({ active });
        }
      },
    };
  });
