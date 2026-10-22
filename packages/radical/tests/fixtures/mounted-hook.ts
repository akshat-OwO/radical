import { assert } from "@effect/vitest";
import { Effect } from "effect";
import type { Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type { Bridge } from "../../src/core/bridge/bridge.ts";
import { RadicalProvider } from "../../src/react/react.ts";

export const mountHook = <A>(
  hook: () => A,
  layer: Layer.Layer<Bridge>,
  committed?: (value: A) => void
) =>
  Effect.gen(function* () {
    let state: A | undefined;
    const Probe = () => {
      const value = hook();
      useLayoutEffect(() => {
        state = value;
        committed?.(value);
      }, [value]);
      return null;
    };
    const root = createRoot(document.createElement("div"));
    let mounted = true;
    const unmount = () => {
      if (mounted) {
        mounted = false;
        flushSync(() => {
          root.unmount();
        });
      }
    };
    yield* Effect.addFinalizer(() => Effect.sync(unmount));
    const render = (next = layer) => {
      flushSync(() => {
        root.render(
          createElement(RadicalProvider, { layer: next }, createElement(Probe))
        );
      });
    };
    render();
    return {
      state: () => {
        assert.isDefined(state);
        return state;
      },
      render,
      unmount,
    };
  });
