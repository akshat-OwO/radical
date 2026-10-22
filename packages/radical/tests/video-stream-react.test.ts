// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import type { Layer as EffectLayer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { Bridge, bridgeTestLayer } from "../src/bridge.ts";
import { RadicalProvider, useVideoStream } from "../src/react.ts";
import type { VideoStreamState } from "../src/react.ts";

const Probe = ({
  committed,
  viewfinder,
  onDetect,
}: {
  readonly onDetect?: (value: string) => void;
  readonly viewfinder: { current: HTMLDivElement };
  readonly committed: (state: VideoStreamState) => void;
}) => {
  const state = useVideoStream({ viewfinder, onDetect });
  useLayoutEffect(() => {
    committed(state);
  }, [committed, state]);
  return null;
};
it.effect(
  "suppresses duplicate starts, stops, restarts, and releases on unmount",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<boolean>();
        const idle = yield* Deferred.make<boolean>();
        const stopped = yield* Deferred.make<boolean>();
        const restarted = yield* Deferred.make<boolean>();
        const unmounted = yield* Deferred.make<boolean>();
        let state: VideoStreamState | undefined;
        let starts = 0;
        let stops = 0;
        const layer = Layer.succeed(Bridge, {
          runtime: Effect.succeed("android" as const),
          observe: () => Effect.succeed(() => {}),
          listen: () => Effect.succeed(Effect.void),
          call: (_plugin, method) =>
            Effect.gen(function* () {
              if (method === "requestPermissions") {
                return { camera: "granted" };
              }
              if (method === "start") {
                starts += 1;
              }
              if (method === "stop") {
                stops += 1;
                yield* Deferred.succeed(
                  stops === 1 ? stopped : unmounted,
                  true
                );
              }
              if (method === "getAvailableDevices") {
                return { devices: [{}] };
              }
              if (method === "getZoom") {
                return { min: 1, max: 4, current: 1 };
              }
              if (method === "getSupportedFlashModes") {
                return { result: [] };
              }
              if (method === "getVideoFrameRate") {
                return { frameRate: 30 };
              }
              return {};
            }),
        });
        const root = createRoot(document.createElement("div"));
        const unmount = () => {
          flushSync(() => {
            root.unmount();
          });
        };
        yield* Effect.addFinalizer(() => Effect.sync(unmount));
        flushSync(() => {
          root.render(
            createElement(
              RadicalProvider,
              { layer },
              createElement(Probe, {
                viewfinder: { current: document.createElement("div") },
                committed: (next) => {
                  state = next;
                  let signal: typeof running | undefined;
                  if (next.running) {
                    signal = starts === 1 ? running : restarted;
                  } else if (!next.loading && stops === 1) {
                    signal = idle;
                  }
                  if (signal) {
                    queueMicrotask(() => {
                      Effect.runSync(Deferred.succeed(signal, true));
                    });
                  }
                },
              })
            )
          );
        });
        state?.start();
        state?.start();
        yield* Deferred.await(running);
        assert.strictEqual(starts, 1);
        state?.stop();
        yield* Deferred.await(stopped);
        yield* Deferred.await(idle);
        assert.isFalse(state?.running);
        state?.start();
        yield* Deferred.await(restarted);
        assert.strictEqual(starts, 2);
        unmount();
        yield* Deferred.await(unmounted);
        assert.strictEqual(stops, 2);
      })
    )
);

it.effect(
  "provider replacement retires stream state, old actions, and QR callbacks",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<boolean>();
        const stopped = yield* Deferred.make<boolean>();
        let state: VideoStreamState | undefined;
        let emit: ((event: unknown) => void) | undefined;
        let starts = 0;
        const codes: string[] = [];
        const layer = Layer.succeed(Bridge, {
          runtime: Effect.succeed("android" as const),
          observe: () => Effect.succeed(() => {}),
          listen: (_plugin, _event, receive) =>
            Effect.sync(() => {
              emit = receive;
              return Effect.void;
            }),
          call: (_plugin, method) =>
            Effect.gen(function* () {
              if (method === "requestPermissions") {
                return { camera: "granted" };
              }
              if (method === "getAvailableDevices") {
                return { devices: [{}] };
              }
              if (method === "start") {
                starts += 1;
              }
              if (method === "stop") {
                yield* Deferred.succeed(stopped, true);
              }
              if (method === "getZoom") {
                return { min: 1, max: 1, current: 1 };
              }
              if (method === "getSupportedFlashModes") {
                return { result: [] };
              }
              if (method === "getVideoFrameRate") {
                return { frameRate: 30 };
              }
              return {};
            }),
        });
        const root = createRoot(document.createElement("div"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );
        const render = (next: EffectLayer.Layer<Bridge>) => {
          flushSync(() => {
            root.render(
              createElement(
                RadicalProvider,
                { layer: next },
                createElement(Probe, {
                  viewfinder: { current: document.createElement("div") },
                  onDetect: (value) => {
                    codes.push(value);
                  },
                  committed: (value) => {
                    state = value;
                    if (value.running) {
                      queueMicrotask(() => {
                        Effect.runSync(Deferred.succeed(running, true));
                      });
                    }
                  },
                })
              )
            );
          });
        };
        render(layer);
        state?.start();
        yield* Deferred.await(running);
        const oldStart = state?.start;
        const oldSwitch = state?.switchCamera;
        render(
          bridgeTestLayer("ios", () =>
            Effect.die("Old action reached the replacement provider")
          )
        );
        assert.isFalse(state?.running);
        yield* Deferred.await(stopped);
        emit?.({ barcodes: [{ format: "qr_code", value: "late" }] });
        oldStart?.();
        oldSwitch?.();
        yield* Effect.yieldNow;
        assert.strictEqual(starts, 1);
        assert.deepStrictEqual(codes, []);
      })
    )
);
