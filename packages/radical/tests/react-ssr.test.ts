import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { bridgeLayer, getDeviceInfo } from "../src/client.ts";
import { RadicalProvider } from "../src/react.ts";
import { useBridgeEffect } from "../src/use-bridge-effect.ts";

const Probe = () => {
  const state = useBridgeEffect(getDeviceInfo);
  assert.deepStrictEqual(state, {
    loading: true,
    value: undefined,
    error: undefined,
  });
  return createElement("p", null, "loading");
};

it.effect(
  "renders useBridgeEffect on the server without reading the bridge or browser APIs",
  () =>
    Effect.sync(() => {
      const layer = bridgeLayer(() =>
        assert.fail("SSR read the injected bridge")
      );
      assert.strictEqual(typeof window, "undefined");
      assert.strictEqual(
        renderToString(
          createElement(RadicalProvider, { layer }, createElement(Probe))
        ),
        "<p>loading</p>"
      );
    })
);
