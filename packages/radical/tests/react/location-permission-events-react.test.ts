// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  locationLive,
  watchLocation,
} from "../../src/capabilities/location/location-pool.ts";
import {
  getCurrentLocation,
  requestLocationPermission,
} from "../../src/capabilities/location/location.ts";
import { installNavigatorLocation } from "../../src/capabilities/location/navigator-location.ts";
import { Bridge, BridgeCallFailed } from "../../src/core/bridge/bridge.ts";
import { requestLocationPermission as requestPlain } from "../../src/plain/client.ts";
import {
  createEffectRuntime,
  getEffectRuntime,
} from "../../src/plain/runtime.ts";
import type { RadicalRuntime } from "../../src/plain/runtime.ts";
import { RadicalProvider } from "../../src/react/react.ts";
import { useLocationPermission } from "../../src/react/use-location.ts";
import type { LocationPermissionState } from "../../src/react/use-location.ts";
import { locationFixture } from "../capabilities/location/fixture.ts";

const mount = (runtime: RadicalRuntime, waitForInitial = true) =>
  Effect.gen(function* () {
    const commits = yield* Queue.unbounded<LocationPermissionState>();
    let snapshot: LocationPermissionState | undefined;
    let count = 0;

    const Probe = () => {
      const state = useLocationPermission();
      useLayoutEffect(() => {
        snapshot = state;
        count += 1;
        Queue.offerUnsafe(commits, state);
      }, [state]);

      return null;
    };

    const root = createRoot(document.createElement("div"));

    const render = (next: RadicalRuntime) => {
      flushSync(() => {
        root.render(
          createElement(
            RadicalProvider,
            { runtime: next },
            createElement(Probe)
          )
        );
      });
    };

    const unmount = () => {
      flushSync(() => {
        root.unmount();
      });
    };

    yield* Effect.addFinalizer(() => Effect.sync(unmount));

    const awaitPermission = (expected: "prompt" | "granted" | "denied") =>
      Effect.gen(function* () {
        let state = yield* Queue.take(commits);

        while (state.value?.state !== expected) {
          state = yield* Queue.take(commits);
        }

        assert.isUndefined(state.error);

        return state;
      });

    render(runtime);

    if (waitForInitial) {
      yield* awaitPermission("prompt");
    }

    return {
      nextCommit: () => Queue.take(commits),
      awaitPermission,
      render,
      unmount,
      snapshot: () => snapshot,
      commits: () => count,
    };
  });

for (const source of ["hook", "plain", "effect"] as const) {
  it.effect(
    `${source} permission grants and denials update an already mounted permission hook`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture();
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const probe = yield* mount(runtime);

          const request = () => {
            if (source === "hook") {
              return Effect.sync(() => {
                flushSync(() => {
                  probe.snapshot()?.request();
                });
              });
            }

            return source === "plain"
              ? Effect.promise(
                  async () => await requestPlain(undefined, runtime)
                )
              : Effect.promise(
                  async () =>
                    await getEffectRuntime(runtime).runPromise(
                      locationLive(requestLocationPermission())
                    )
                );
          };

          yield* request();
          assert.strictEqual(
            (yield* probe.awaitPermission("granted")).value?.precision,
            "approximate"
          );
          native.control.requestGranted = false;
          yield* request();
          assert.strictEqual(
            (yield* probe.awaitPermission("denied")).value?.precision,
            "unknown"
          );
        })
      )
  );
}

it.effect(
  "implicit native fix grants and denials update a mounted permission hook",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const original = yield* Bridge.pipe(Effect.provide(native.layer));
        const clock = yield* Clock.Clock;
        let denied = false;

        const bridge = Layer.succeed(Bridge, {
          ...original,
          call: (plugin, method, options) =>
            denied && method === "getCurrentPosition"
              ? Effect.fail(
                  new BridgeCallFailed({
                    plugin,
                    method,
                    cause: { code: "OS-PLUG-GLOC-0003" },
                  })
                )
              : original.call(plugin, method, options),
        });

        const runtime = createEffectRuntime(
          Layer.merge(bridge, Layer.succeed(Clock.Clock, clock))
        );

        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const probe = yield* mount(runtime);
        yield* Effect.promise(
          async () =>
            await getEffectRuntime(runtime).runPromise(
              locationLive(getCurrentLocation())
            )
        );
        yield* probe.awaitPermission("granted");
        denied = true;
        yield* Effect.promise(
          async () =>
            await getEffectRuntime(runtime).runPromise(
              locationLive(getCurrentLocation()).pipe(Effect.flip)
            )
        );
        yield* probe.awaitPermission("denied");
      })
    )
);

it.effect(
  "shared native watch grants and denial callbacks update a mounted permission hook",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const runtime = createEffectRuntime(native.layer);
        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const probe = yield* mount(runtime);

        const fiber = getEffectRuntime(runtime).runFork(
          watchLocation().pipe(Stream.runDrain, Effect.ignore)
        );

        yield* probe.awaitPermission("granted");
        native.fail("OS-PLUG-GLOC-0003");
        yield* probe.awaitPermission("denied");
        yield* Fiber.interrupt(fiber);
        assert.strictEqual(native.released(), 1);
      })
    )
);

it.effect(
  "navigator permission grants and denials reach hooks without manual checks",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const clock = yield* Clock.Clock;

        const runtime = createEffectRuntime(
          Layer.merge(native.layer, Layer.succeed(Clock.Clock, clock))
        );

        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const probe = yield* mount(runtime);

        const target: Pick<Navigator, "geolocation" | "permissions"> = {
          geolocation: {
            getCurrentPosition: () => assert.fail("Unexpected browser fix"),
            watchPosition: () => assert.fail("Unexpected browser watch"),
            clearWatch: () => {
              /* No browser watches. */
            },
          },
          permissions: {
            query: async () =>
              await Effect.die("Unexpected browser query").pipe(
                Effect.runPromise
              ),
          },
        };

        yield* Effect.acquireRelease(
          installNavigatorLocation(target, runtime),
          (release) => release
        ).pipe(Effect.asVoid);
        const fix = yield* Deferred.make<boolean>();
        target.geolocation.getCurrentPosition(() => {
          Effect.runSync(Deferred.succeed(fix, true));
        });
        yield* Deferred.await(fix);
        yield* probe.awaitPermission("granted");
        native.state.coarseLocation = "prompt";
        native.state.location = "prompt";
        native.control.requestGranted = false;
        const error = yield* Deferred.make<number>();
        target.geolocation.getCurrentPosition(
          () => {
            assert.fail("Unexpected denied fix");
          },
          (failure) => {
            Effect.runSync(Deferred.succeed(error, failure.code));
          }
        );
        assert.strictEqual(yield* Deferred.await(error), 1);
        yield* probe.awaitPermission("denied");
      })
    )
);

it.effect(
  "permission event subscriptions retire on provider replacement and unmount",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* locationFixture();
        const second = yield* locationFixture();
        const firstRuntime = createEffectRuntime(first.layer);
        const secondRuntime = createEffectRuntime(second.layer);
        yield* Effect.addFinalizer(() => Effect.promise(firstRuntime.dispose));
        yield* Effect.addFinalizer(() => Effect.promise(secondRuntime.dispose));
        const probe = yield* mount(firstRuntime);
        probe.render(secondRuntime);
        yield* probe.awaitPermission("prompt");
        yield* Effect.promise(
          async () => await requestPlain(undefined, firstRuntime)
        );
        assert.strictEqual(probe.snapshot()?.value?.state, "prompt");
        yield* Effect.promise(
          async () => await requestPlain(undefined, secondRuntime)
        );
        yield* probe.awaitPermission("granted");
        probe.unmount();
        const commits = probe.commits();
        second.control.requestGranted = false;
        yield* Effect.promise(
          async () => await requestPlain(undefined, secondRuntime)
        );
        assert.strictEqual(probe.commits(), commits);
      })
    )
);

it.effect(
  "a delayed initial check cannot replace a newer grant from another API",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const original = yield* Bridge.pipe(Effect.provide(native.layer));
        const started = yield* Deferred.make<boolean>();
        const response = yield* Deferred.make<unknown>();
        let checking = true;

        const bridge = Layer.succeed(Bridge, {
          ...original,
          call: (plugin, method, options) => {
            if (method === "checkPermissions" && checking) {
              checking = false;

              return Deferred.succeed(started, true).pipe(
                Effect.andThen(Deferred.await(response))
              );
            }

            return original.call(plugin, method, options);
          },
        });

        const runtime = createEffectRuntime(bridge);
        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const probe = yield* mount(runtime, false);
        yield* Deferred.await(started);
        yield* Effect.promise(
          async () => await requestPlain(undefined, runtime)
        );
        yield* probe.awaitPermission("granted");
        yield* Deferred.succeed(response, {
          location: "prompt",
          coarseLocation: "prompt",
        });
        assert.strictEqual((yield* probe.nextCommit()).value?.state, "granted");
      })
    )
);

it.effect(
  "a native permission grant is published even when acquiring the fix subsequently fails",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const original = yield* Bridge.pipe(Effect.provide(native.layer));
        const clock = yield* Clock.Clock;

        const bridge = Layer.succeed(Bridge, {
          ...original,
          call: (plugin, method, options) => {
            if (method === "getCurrentPosition") {
              native.state.coarseLocation = "granted";

              return Effect.fail(
                new BridgeCallFailed({
                  plugin,
                  method,
                  cause: { code: "OS-PLUG-GLOC-0010" },
                })
              );
            }

            return original.call(plugin, method, options);
          },
        });

        const runtime = createEffectRuntime(
          Layer.merge(bridge, Layer.succeed(Clock.Clock, clock))
        );

        yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
        const probe = yield* mount(runtime);

        const error = yield* Effect.promise(
          async () =>
            await getEffectRuntime(runtime).runPromise(
              locationLive(getCurrentLocation()).pipe(Effect.flip)
            )
        );

        assert.strictEqual(error._tag, "LocationTimeout");
        assert.strictEqual(
          (yield* probe.awaitPermission("granted")).value?.precision,
          "approximate"
        );
      })
    )
);

for (const replacement of [false, true]) {
  it.effect(
    `mounted permission hooks refresh on resume with navigator replacement ${replacement ? "enabled" : "disabled"}, sharing a single check`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture();
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const first = yield* mount(runtime);
          const second = yield* mount(runtime);
          let status: PermissionStatus | undefined;
          let restore = Effect.void;

          if (replacement) {
            const target: Pick<Navigator, "geolocation" | "permissions"> = {
              geolocation: {
                getCurrentPosition: () => assert.fail("Unexpected browser fix"),
                watchPosition: () => assert.fail("Unexpected browser watch"),
                clearWatch: () => {
                  /* No browser watches. */
                },
              },
              permissions: {
                query: async () =>
                  await Effect.runPromise(
                    Effect.die("Unexpected browser query")
                  ),
              },
            };

            restore = yield* installNavigatorLocation(target, runtime);
            yield* Effect.addFinalizer(() => restore);
            status = yield* Effect.promise(
              async () =>
                await target.permissions.query({ name: "geolocation" })
            );
          }

          assert.strictEqual(yield* Queue.take(native.activityStarts), 1);
          assert.strictEqual(native.activityListeners(), 1);

          const checks = () =>
            native.calls.filter((call) => call.method === "checkPermissions")
              .length;

          const initial = checks();
          native.state.coarseLocation = "granted";
          native.active(false);
          native.active(true);
          assert.strictEqual(
            (yield* first.awaitPermission("granted")).value?.precision,
            "approximate"
          );
          yield* second.awaitPermission("granted");
          assert.strictEqual(checks(), initial + 1);

          if (status) {
            assert.strictEqual(status.state, "granted");
          }

          first.unmount();
          assert.strictEqual(native.activityListeners(), 1);
          native.state.coarseLocation = "denied";
          native.state.location = "denied";
          native.active(true);
          yield* second.awaitPermission("denied");
          assert.strictEqual(checks(), initial + 2);

          if (status) {
            assert.strictEqual(status.state, "denied");
          }

          second.unmount();
          yield* restore;
          assert.strictEqual(yield* Queue.take(native.activityReleases), 1);
          assert.strictEqual(native.activityListeners(), 0);
          native.active(true);
          assert.strictEqual(checks(), initial + 2);
        })
      )
  );
}

for (const platform of ["android", "ios"] as const) {
  it.effect(
    `${platform} permission hooks resolve with services off and refresh authorization on resume`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const native = yield* locationFixture(platform);
          native.control.servicesEnabled = false;
          const runtime = createEffectRuntime(native.layer);
          yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));
          const probe = yield* mount(runtime, false);
          yield* probe.awaitPermission(
            platform === "ios" ? "denied" : "prompt"
          );
          flushSync(() => {
            probe.snapshot()?.request();
          });
          yield* probe.awaitPermission(
            platform === "ios" ? "denied" : "granted"
          );
          assert.isUndefined(probe.snapshot()?.error);
          native.control.servicesEnabled = true;
          native.state.location = "denied";
          native.state.coarseLocation =
            platform === "ios" ? "granted" : "denied";
          native.active(true);
          yield* probe.awaitPermission(
            platform === "ios" ? "granted" : "denied"
          );
          assert.isUndefined(probe.snapshot()?.error);
          assert.isTrue(
            native.calls
              .filter((call) =>
                ["checkPermissions", "requestPermissions"].includes(call.method)
              )
              .every((call) => call.plugin === "RadicalLocation")
          );
        })
      )
  );
}
