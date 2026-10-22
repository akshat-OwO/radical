// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { bridgeTestLayer } from "../src/bridge.ts";
import { RadicalProvider, useGoogleSignIn } from "../src/react.ts";
import type { GoogleSignInState } from "../src/react.ts";

it.effect(
  "reports unavailable in browsers and keeps the sign-in action stable",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let state: GoogleSignInState | undefined;
        const settled = yield* Deferred.make<boolean>();
        const layer = bridgeTestLayer("browser", () =>
          Effect.sync(() => assert.fail("Browser sign-in called native code"))
        );
        const Probe = () => {
          const google = useGoogleSignIn();
          useLayoutEffect(() => {
            state = google;
            if (google.error) {
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(settled, true));
              });
            }
          }, [google]);
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
        const initial = state;
        assert.isDefined(initial);
        assert.isFalse(initial.loading);
        assert.isUndefined(initial.value);
        assert.isUndefined(initial.error);
        flushSync(() => {
          initial.signIn();
        });
        yield* Deferred.await(settled);
        assert.strictEqual(state?.signIn, initial.signIn);
        assert.strictEqual(state?.error?._tag, "GoogleSignInUnavailable");
        assert.isFalse(state?.loading);
        assert.isUndefined(state?.value);
      })
    )
);
