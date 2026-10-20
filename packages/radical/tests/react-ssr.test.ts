import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { bridgeLayer, getDeviceInfo } from "../src/client.ts";
import { RadicalProvider, useSafeArea } from "../src/react.ts";
import { useBridgeEffect } from "../src/use-bridge-effect.ts";

const SafeAreaProbe = () =>
  createElement("pre", null, JSON.stringify(useSafeArea()));

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

it.effect(
  "renders native safe area from the provider without browser APIs",
  () =>
    Effect.sync(() => {
      const area = { top: 62, right: 0, bottom: 34, left: 0 };
      const html = renderToString(
        createElement(
          RadicalProvider,
          {
            nativeContext: {
              platform: "ios",
              safeArea: area,
              shellVersion: "1",
            },
          },
          createElement(SafeAreaProbe)
        )
      );
      assert.strictEqual(
        html,
        renderToString(createElement("pre", null, JSON.stringify(area)))
      );
    })
);
