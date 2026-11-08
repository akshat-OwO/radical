// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer, Stream } from "effect";
import { createElement, useEffect, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  getTrackingSession,
  startTrackingSession,
  stopTrackingSession,
  watchTrackingSession,
} from "../../src/capabilities/tracking-session/tracking-session.ts";
import { Bridge, bridgeLayer } from "../../src/core/bridge/bridge.ts";
import { Unavailable } from "../../src/core/errors.ts";
import { RadicalProvider } from "../../src/react/react.ts";
import { useTrackingSession } from "../../src/react/use-tracking-session.ts";

const actions: readonly (readonly [
  string,
  Effect.Effect<unknown, unknown, Bridge>,
])[] = [
  ["start", startTrackingSession({ preset: "balanced" })],
  ["get", getTrackingSession],
  ["stop", stopTrackingSession("old")],
  ["watch", Stream.runCollect(watchTrackingSession)],
];

for (const platform of ["browser", "android"] as const) {
  for (const [name, action] of actions) {
    it.effect(
      `${platform} ${name} returns Unavailable without invoking native code when tracking is absent`,
      () =>
        Effect.gen(function* () {
          let calls = 0;

          const layer = bridgeLayer(
            () => ({
              getPlatform: () => platform,
              nativePromise: async () => {
                calls += 1;

                return await Effect.runPromise(Effect.succeed({}));
              },
              nativeCallback: () => {
                calls += 1;

                return "callback";
              },
            }),
            undefined,
            () => ({ RadicalLocation: ["getCurrentPosition"] })
          );

          const error: unknown = yield* action.pipe(
            Effect.provide(layer),
            Effect.flip
          );

          assert.instanceOf(error, Unavailable);
          assert.strictEqual(calls, 0);
        })
    );
  }
}

for (const action of ["start", "stop", "refresh"] as const) {
  it.effect(`browser hook ${action} reports Unavailable`, () =>
    Effect.gen(function* () {
      const received = yield* Deferred.make<unknown>();

      // Keep observation pending so only the requested action can report an error.
      const layer = Layer.effect(
        Bridge,
        Bridge.pipe(
          Effect.map((bridge) => ({
            ...bridge,
            listen: () => Effect.never,
          }))
        )
      ).pipe(Layer.provide(bridgeLayer(() => {})));

      const Screen = () => {
        const { start, stop, refresh, error } = useTrackingSession();
        useEffect(() => {
          if (action === "start") {
            start({ preset: "balanced" });
          } else if (action === "stop") {
            stop("old");
          } else {
            refresh();
          }
        }, [start, stop, refresh]);
        useLayoutEffect(() => {
          if (error !== undefined) {
            Effect.runSync(Deferred.succeed(received, error));
          }
        }, [error]);

        return null;
      };

      const root = createRoot(document.createElement("div"));
      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          flushSync(() => {
            root.render(
              createElement(RadicalProvider, { layer }, createElement(Screen))
            );
          });
        }),
        () =>
          Deferred.await(received).pipe(
            Effect.map((error) => {
              assert.instanceOf(error, Unavailable);

              return true;
            })
          ),
        () =>
          Effect.yieldNow.pipe(
            Effect.andThen(
              Effect.sync(() => {
                flushSync(() => {
                  root.unmount();
                });
              })
            )
          )
      );
    })
  );
}
