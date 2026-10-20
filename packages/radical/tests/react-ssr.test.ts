import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { bridgeLayer } from "../src/client.ts";
import { useDeviceInfo } from "../src/react.ts";

it.effect(
  "renders useDeviceInfo on the server without reading the bridge or browser APIs",
  () =>
    Effect.sync(() => {
      const layer = bridgeLayer(() =>
        assert.fail("SSR read the injected bridge")
      );
      const Probe = () => {
        const state = useDeviceInfo(layer);
        assert.deepStrictEqual(state, {
          loading: true,
          value: undefined,
          error: undefined,
        });
        return createElement("p", null, "loading");
      };
      assert.strictEqual(typeof window, "undefined");
      assert.strictEqual(
        renderToString(createElement(Probe)),
        "<p>loading</p>"
      );
    })
);
