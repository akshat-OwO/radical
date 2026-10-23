// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { StrictMode, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { getDeviceInfo } from "../../src/capabilities/device-info/device-info.ts";
import { Bridge, bridgeTestLayer } from "../../src/core/bridge/bridge.ts";
import {
  RadicalProvider,
  useBridgeEffect,
} from "../../src/react/use-bridge-effect.ts";

it.effect(
  "retains one runtime through StrictMode replay and disposes it on unmount",
  () =>
    Effect.gen(function* () {
      const loaded = yield* Deferred.make<boolean>();

      const released = yield* Deferred.make<boolean>();
      let acquisitions = 0;

      const bridge = yield* Bridge.pipe(
        Effect.provide(bridgeTestLayer("browser", () => Effect.never))
      );

      const layer = Layer.effect(
        Bridge,
        Effect.acquireRelease(
          Effect.sync(() => {
            acquisitions += 1;

            return bridge;
          }),
          () => Deferred.succeed(released, true)
        )
      );

      const read = getDeviceInfo.pipe(
        Effect.tap(() => Deferred.succeed(loaded, true))
      );

      const Probe = () => {
        useBridgeEffect(read);

        return null;
      };

      const container = document.createElement("div");

      const root = createRoot(container);

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          flushSync(() => {
            root.unmount();
          });
        })
      );
      flushSync(() => {
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(RadicalProvider, { layer }, createElement(Probe))
          )
        );
      });

      yield* Deferred.await(loaded);

      assert.strictEqual(acquisitions, 1);
      flushSync(() => {
        root.unmount();
      });

      yield* Deferred.await(released);
    }).pipe(Effect.scoped)
);
