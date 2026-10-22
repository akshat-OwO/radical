// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../src/core/bridge/bridge.ts";
import {
  RadicalProvider,
  useFilePicker,
  useIntent,
} from "../../src/react/react.ts";
import type { FilePickerState, IntentState } from "../../src/react/react.ts";

it.effect(
  "reports intent results and picker cancellation through hook state",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* Deferred.make<boolean>();
        const missing = yield* Deferred.make<boolean>();
        const cancelled = yield* Deferred.make<boolean>();
        let intent: IntentState | undefined;
        let picker: FilePickerState | undefined;
        let completed = true;
        const layer = bridgeTestLayer("android", (plugin, method) =>
          plugin === "AppLauncher"
            ? Effect.succeed({ completed })
            : Effect.fail(
                new BridgeCallFailed({
                  plugin,
                  method,
                  cause: { message: "pickFiles canceled." },
                })
              )
        );
        const Probe = () => {
          const intentState = useIntent();
          const pickerState = useFilePicker();
          useLayoutEffect(() => {
            intent = intentState;
            picker = pickerState;
            const settle = (signal: Deferred.Deferred<boolean>) => {
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(signal, true));
              });
            };
            if (intentState.value === true) {
              settle(opened);
            }
            if (intentState.error?._tag === "NoHandler") {
              settle(missing);
            }
            if (pickerState.error?._tag === "Cancelled") {
              settle(cancelled);
            }
          }, [intentState, pickerState]);
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
        assert.deepStrictEqual(
          { loading: intent?.loading, value: intent?.value },
          { loading: false, value: undefined }
        );
        intent?.openUrl("https://example.test");
        yield* Deferred.await(opened);
        completed = false;
        intent?.openUrl("geo:0,0");
        yield* Deferred.await(missing);
        picker?.pick({ multiple: true });
        yield* Deferred.await(cancelled);
        assert.isUndefined(picker?.value);
      })
    )
);
