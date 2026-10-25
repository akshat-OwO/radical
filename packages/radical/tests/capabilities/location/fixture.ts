// oxlint-disable anti-slop/no-unknown-parameters -- The test bridge deliberately accepts malformed native callback payloads.
import { Effect, Layer, Queue, Schema } from "effect";

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
    const nativeFix = platform === "ios" ? iosSimulatorFix : androidFix;
    const starts = yield* Queue.unbounded<number>();
    const releases = yield* Queue.unbounded<number>();
    const activityStarts = yield* Queue.unbounded<number>();
    const activityReleases = yield* Queue.unbounded<number>();
    let activityStarted = 0;
    let activityReleased = 0;
    let count = 0;
    let released = 0;
    let receive: ((value: unknown, error?: BridgeError) => void) | undefined;
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
          receive = (value, error) => {
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
          };

          Queue.offerUnsafe(starts, count);
          receive(
            { ...nativeFix, timestamp: control.timestamp },
            control.servicesEnabled
              ? undefined
              : new BridgeCallFailed({
                  plugin: _plugin,
                  method: _method,
                  cause: { code: "OS-PLUG-GLOC-0007" },
                })
          );

          return Effect.sync(() => {
            released += 1;
            receive = undefined;
            Queue.offerUnsafe(releases, released);
          });
        }),
    });

    return {
      layer,
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
        receive?.(value);
      },
      fail: (code: string) => {
        receive?.(
          undefined,
          new BridgeCallFailed({
            plugin: "Geolocation",
            method: "watchPosition",
            cause: { code },
          })
        );
      },
      active: (active: boolean) => {
        for (const receiveActivity of activity) {
          receiveActivity({ active });
        }
      },
    };
  });
