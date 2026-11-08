// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { createElement, useLayoutEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { bridgeLayer } from "../../src/core/bridge/bridge.ts";
import { RadicalProvider } from "../../src/react/react.ts";
import { useTrackingSession } from "../../src/react/use-tracking-session.ts";

it.effect(
  "hydrates the server tracking state without bridge reads or hydration errors",
  () =>
    Effect.gen(function* () {
      let reads = 0;

      const layer = bridgeLayer(() => {
        reads += 1;
      });

      const hydrated = yield* Deferred.make<boolean>();
      const states: string[] = [];
      const errors: unknown[] = [];

      const Screen = () => {
        const { value, loading, error } = useTrackingSession();

        const state = JSON.stringify({
          value,
          loading,
          error: error === undefined ? null : JSON.stringify(error),
        });

        states.push(state);
        useLayoutEffect(() => {
          Effect.runSync(Deferred.succeed(hydrated, true));
        }, []);

        return createElement("p", null, state);
      };

      const element = createElement(
        RadicalProvider,
        { layer },
        createElement(Screen)
      );

      const markup = renderToString(element);
      assert.strictEqual(reads, 0);
      const container = document.createElement("div");
      container.innerHTML = markup;
      yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          hydrateRoot(container, element, {
            onRecoverableError: (error) => {
              errors.push(error);
            },
          })
        ),
        () =>
          Deferred.await(hydrated).pipe(
            Effect.andThen(
              Effect.sync(() => {
                assert.strictEqual(
                  states[0],
                  '{"value":null,"loading":true,"error":null}'
                );
                assert.strictEqual(states[1], states[0]);
                assert.deepStrictEqual(errors, []);
              })
            )
          ),
        (root) =>
          Effect.sync(() => {
            root.unmount();
          })
      );
    })
);
