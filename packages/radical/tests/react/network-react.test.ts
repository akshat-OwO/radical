// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type { NetworkStatus } from "../../src/capabilities/network/network.ts";
import { Bridge, BridgeCallFailed } from "../../src/core/bridge/bridge.ts";
import { RadicalProvider, useNetworkStatus } from "../../src/react/react.ts";
import type { NetworkStatusState } from "../../src/react/react.ts";

const nativeFixture = (
  runtime: "android" | "ios",
  current: Effect.Effect<unknown, BridgeCallFailed> = Effect.succeed({
    connected: true,
    connectionType: "wifi",
  })
) => {
  let receive: Parameters<Bridge["Service"]["observe"]>[1] | undefined;
  let removed = 0;

  const layer = Layer.succeed(Bridge, {
    runtime: Effect.succeed(runtime),
    observe: () => Effect.succeed(() => {}),
    call: () => current,
    listen: (_plugin, _event, listener) =>
      Effect.sync(() => {
        receive = listener;

        return Effect.sync(() => {
          removed += 1;
        });
      }),
  });

  return {
    layer,
    emit: (value: NetworkStatus) => {
      receive?.(value);
    },
    removed: () => removed,
  };
};

it.effect(
  "updates network hook on events and retires subscriptions on provider replacement and unmount",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = nativeFixture("android");
        const second = nativeFixture("ios");
        const initial = yield* Deferred.make<boolean>();
        const offline = yield* Deferred.make<boolean>();
        const replaced = yield* Deferred.make<boolean>();
        let owner = first;
        let state: NetworkStatusState | undefined;

        const Probe = () => {
          const status = useNetworkStatus();
          useLayoutEffect(() => {
            state = status;
            let signal = initial;

            if (owner === second) {
              signal = replaced;
            } else if (status.value?.connected === false) {
              signal = offline;
            }

            if (!status.loading) {
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(signal, true));
              });
            }
          }, [status]);

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

        const render = () => {
          flushSync(() => {
            root.render(
              createElement(
                RadicalProvider,
                { layer: owner.layer },
                createElement(Probe)
              )
            );
          });
        };

        render();
        yield* Deferred.await(initial);
        assert.strictEqual(state?.value?.connectionType, "wifi");
        first.emit({ connected: false, connectionType: "none" });
        yield* Deferred.await(offline);
        assert.isFalse(state?.value?.connected);
        owner = second;
        render();
        yield* Deferred.await(replaced);
        assert.strictEqual(first.removed(), 1);
        assert.isTrue(state?.value?.connected);
        first.emit({ connected: false, connectionType: "none" });
        flushSync(() => {
          root.unmount();
        });
        assert.strictEqual(second.removed(), 1);
        second.emit({ connected: false, connectionType: "none" });
      })
    )
);

it.effect(
  "reports native network failure and releases the mounted hook listener",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = new BridgeCallFailed({
          plugin: "Network",
          method: "getStatus",
          cause: "failed",
        });

        const fake = nativeFixture("ios", Effect.fail(failure));
        const failed = yield* Deferred.make<boolean>();

        const Probe = () => {
          const state = useNetworkStatus();
          useLayoutEffect(() => {
            if (state.error) {
              assert.strictEqual(state.error, failure);
              assert.isFalse(state.loading);
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(failed, true));
              });
            }
          }, [state]);

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
            createElement(
              RadicalProvider,
              { layer: fake.layer },
              createElement(Probe)
            )
          );
        });
        yield* Deferred.await(failed);
        assert.strictEqual(fake.removed(), 1);
      })
    )
);
