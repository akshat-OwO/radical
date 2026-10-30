// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import type { Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { bridgeLayer, bridgeTestLayer } from "../../src/core/bridge/bridge.ts";
import type { Bridge } from "../../src/core/bridge/bridge.ts";
import {
  RadicalProvider,
  useCamera,
  useCameraPermission,
} from "../../src/react/react.ts";
import type {
  CameraState,
  CameraPermissionState,
} from "../../src/react/react.ts";

const Probe = ({
  committed,
}: {
  readonly committed: (
    camera: CameraState,
    permission: CameraPermissionState
  ) => void;
}) => {
  const camera = useCamera();
  const permission = useCameraPermission();
  useLayoutEffect(() => {
    committed(camera, permission);
  }, [camera, permission, committed]);

  return null;
};

const mount = (
  layer: Layer.Layer<Bridge>,
  committed: (camera: CameraState, permission: CameraPermissionState) => void
) =>
  Effect.gen(function* () {
    const root = createRoot(document.createElement("div"));

    const render = (next = layer) => {
      flushSync(() => {
        root.render(
          createElement(
            RadicalProvider,
            { layer: next },
            createElement(Probe, { committed })
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
    render();

    return { render, unmount };
  });

it.effect(
  "checks permission on mount, requests on action, and permits a second check",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const prompt = yield* Deferred.make<boolean>();
        const granted = yield* Deferred.make<boolean>();
        const checked = yield* Deferred.make<boolean>();
        let permission: CameraPermissionState | undefined;
        const methods: string[] = [];
        let nativeGranted = false;
        yield* mount(
          bridgeTestLayer("ios", (_plugin, method) =>
            Effect.sync(() => {
              methods.push(method);

              if (method === "requestPermissions") {
                nativeGranted = true;
              }

              return { camera: nativeGranted ? "granted" : "prompt" };
            })
          ),
          (_camera, state) => {
            permission = state;

            if (state.loading) {
              return;
            }

            if (state.value === undefined) {
              return;
            }

            let signal = checked;

            if (state.value === "prompt") {
              signal = prompt;
            } else if (methods.length === 2) {
              signal = granted;
            }

            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(signal, true));
            });
          }
        );
        yield* Deferred.await(prompt);
        assert.deepStrictEqual(methods, ["checkPermissions"]);
        permission?.request();
        yield* Deferred.await(granted);
        assert.strictEqual(permission?.value, "granted");
        permission?.check();
        yield* Deferred.await(checked);
        assert.deepStrictEqual(methods, [
          "checkPermissions",
          "requestPermissions",
          "checkPermissions",
        ]);
      })
    )
);

it.effect("suppresses duplicate captures and interrupts work on unmount", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const checked = yield* Deferred.make<boolean>();
      const started = yield* Deferred.make<boolean>();
      const interrupted = yield* Deferred.make<boolean>();
      let camera: CameraState | undefined;
      let captures = 0;

      const mounted = yield* mount(
        bridgeTestLayer("android", (_plugin, method) => {
          if (method === "checkPermissions") {
            return Effect.succeed({ camera: "granted" });
          }

          captures += 1;

          return Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, true))
          );
        }),
        (state, permission) => {
          camera = state;

          if (permission.value === "granted") {
            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(checked, true));
            });
          }
        }
      );

      yield* Deferred.await(checked);
      camera?.capture();
      camera?.capture();
      yield* Deferred.await(started);
      assert.strictEqual(captures, 1);
      mounted.unmount();
      yield* Deferred.await(interrupted);
    })
  )
);

it.effect("interrupts the previous provider and ignores its old actions", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<boolean>();
      const interrupted = yield* Deferred.make<boolean>();
      const done = yield* Deferred.make<boolean>();
      let oldAction: (() => void) | undefined;
      let calls = 0;

      const mounted = yield* mount(
        bridgeTestLayer("ios", () =>
          Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, true))
          )
        ),
        (_camera, permission) => {
          oldAction ??= permission.request;

          if (permission.value === "denied") {
            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(done, true));
            });
          }
        }
      );

      yield* Deferred.await(started);
      mounted.render(
        bridgeTestLayer("android", () =>
          Effect.sync(() => {
            calls += 1;

            return { camera: "denied" };
          })
        )
      );
      yield* Deferred.await(interrupted);
      yield* Deferred.await(done);
      oldAction?.();
      yield* Effect.yieldNow;
      assert.strictEqual(calls, 1);
    })
  )
);

it.effect(
  "reports an unavailable camera permission command without calling native",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const done = yield* Deferred.make<CameraPermissionState>();
        let calls = 0;
        yield* mount(
          bridgeLayer(
            () => ({
              getPlatform: () => "ios",
              nativePromise: async () => {
                calls += 1;

                return await Effect.runPromise(
                  Effect.succeed({ camera: "granted" })
                );
              },
            }),
            undefined,
            () => ({ Camera: ["getPhoto"] })
          ),
          (_camera, permission) => {
            if (permission.error) {
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(done, permission));
              });
            }
          }
        );
        const state = yield* Deferred.await(done);
        assert.strictEqual(state.error?._tag, "BridgeUnavailable");
        assert.isFalse(state.loading);
        assert.strictEqual(calls, 0);
      })
    )
);
