// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Clock, Effect, Layer, Queue } from "effect";
import { createElement, useEffect, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { RadicalProvider } from "../../src/react/react.ts";
import {
  useLocation,
  useLocationPermission,
  useLocationWatch,
} from "../../src/react/use-location.ts";
import type {
  LocationState,
  LocationPermissionState,
  LocationWatchState,
} from "../../src/react/use-location.ts";
import { locationFixture } from "../capabilities/location/fixture.ts";

it.effect(
  "location watches start explicitly and stop on stop, provider replacement and unmount",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* locationFixture();
        const second = yield* locationFixture("ios");
        const received = yield* Queue.unbounded<LocationWatchState>();
        let snapshot: LocationWatchState | undefined;

        const Probe = () => {
          const state = useLocationWatch();
          useLayoutEffect(() => {
            snapshot = state;

            if (state.value) {
              Queue.offerUnsafe(received, state);
            }
          }, [state]);

          return null;
        };

        const current = () => {
          if (!snapshot) {
            return assert.fail("Probe has not committed");
          }

          return snapshot;
        };

        const root = createRoot(document.createElement("div"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );

        const render = (layer: typeof first.layer) => {
          flushSync(() => {
            root.render(
              createElement(RadicalProvider, { layer }, createElement(Probe))
            );
          });
        };

        render(first.layer);
        assert.isFalse(current().running);
        assert.strictEqual(first.count(), 0);
        flushSync(() => {
          current().start();
        });
        const running = yield* Queue.take(received);
        assert.isTrue(running.running);
        assert.strictEqual(running.value?.latitude, 51);
        flushSync(() => {
          current().stop();
        });
        assert.strictEqual(yield* Queue.take(first.releases), 1);
        flushSync(() => {
          current().start();
        });
        yield* Queue.take(received);
        const retiredStart = current().start;
        render(second.layer);
        assert.strictEqual(yield* Queue.take(first.releases), 2);
        assert.isFalse(current().running);
        flushSync(retiredStart);
        assert.strictEqual(second.count(), 0);
        flushSync(() => {
          current().start();
        });
        yield* Queue.take(received);
        flushSync(() => {
          root.unmount();
        });
        assert.strictEqual(yield* Queue.take(second.releases), 1);
      })
    )
);

it.effect(
  "location hook actions keep their identities through permission requests, fixes, watch starts and stops",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const clock = yield* Clock.Clock;

        const layer = Layer.merge(
          native.layer,
          Layer.succeed(Clock.Clock, clock)
        );

        const commits = yield* Queue.unbounded<{
          watch: LocationWatchState;
          location: LocationState;
          permission: LocationPermissionState;
        }>();

        const Probe = () => {
          const watch = useLocationWatch();
          const location = useLocation();
          const permission = useLocationPermission();
          useLayoutEffect(() => {
            Queue.offerUnsafe(commits, { watch, location, permission });
          }, [watch, location, permission]);

          return null;
        };

        const root = createRoot(document.createElement("div"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );
        flushSync(() => {
          root.render(
            createElement(RadicalProvider, { layer }, createElement(Probe))
          );
        });
        const initial = yield* Queue.take(commits);

        const awaitState = (ready: (state: typeof initial) => boolean) =>
          Effect.gen(function* () {
            let state = yield* Queue.take(commits);

            while (!ready(state)) {
              state = yield* Queue.take(commits);
            }

            assert.strictEqual(state.watch.start, initial.watch.start);
            assert.strictEqual(state.watch.stop, initial.watch.stop);
            assert.strictEqual(
              state.location.getCurrent,
              initial.location.getCurrent
            );
            assert.strictEqual(
              state.permission.check,
              initial.permission.check
            );
            assert.strictEqual(
              state.permission.request,
              initial.permission.request
            );

            return state;
          });

        yield* awaitState(
          (state) => state.permission.value?.state === "prompt"
        );
        flushSync(() => {
          initial.permission.request();
        });
        yield* awaitState(
          (state) => state.permission.value?.state === "granted"
        );
        flushSync(() => {
          initial.location.getCurrent();
        });
        yield* awaitState((state) => state.location.value !== undefined);
        flushSync(() => {
          initial.watch.start();
        });
        yield* awaitState((state) => state.watch.value !== undefined);
        flushSync(() => {
          initial.watch.stop();
        });
        yield* awaitState((state) => !state.watch.running);
        assert.strictEqual(yield* Queue.take(native.releases), 1);
      })
    )
);

it.effect(
  "starting a location watch in an effect with start and stop dependencies subscribes once without looping",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* locationFixture();
        const value = yield* Queue.unbounded<LocationWatchState>();
        let setups = 0;
        let cleanups = 0;

        const Probe = ({ revision }: { readonly revision: number }) => {
          const state = useLocationWatch();
          const { start, stop } = state;
          useEffect(() => {
            setups += 1;
            assert.strictEqual(setups, 1);
            start();

            return () => {
              cleanups += 1;
              stop();
            };
          }, [start, stop]);
          useLayoutEffect(() => {
            if (state.value) {
              Queue.offerUnsafe(value, state);
            }
          }, [state]);

          return createElement("span", null, revision);
        };

        const root = createRoot(document.createElement("div"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );

        const render = (revision: number) => {
          flushSync(() => {
            root.render(
              createElement(
                RadicalProvider,
                { layer: native.layer },
                createElement(Probe, { revision })
              )
            );
          });
        };

        render(0);
        assert.strictEqual((yield* Queue.take(value)).value?.latitude, 51);
        render(1);
        yield* Queue.take(value);
        assert.strictEqual(setups, 1);
        assert.strictEqual(cleanups, 0);
        assert.strictEqual(native.count(), 1);
        flushSync(() => {
          root.unmount();
        });
        assert.strictEqual(yield* Queue.take(native.releases), 1);
        assert.strictEqual(cleanups, 1);
      })
    )
);
