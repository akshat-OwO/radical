import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { bridgeLayer } from "../../src/core/bridge/bridge.ts";
import { RadicalProvider } from "../../src/react/react.ts";
import { useTrackingSession } from "../../src/react/use-tracking-session.ts";

const Screen = () => {
  const { value, loading, error } = useTrackingSession();
  assert.strictEqual(value, null);
  assert.strictEqual(loading, true);
  assert.strictEqual(error, undefined);

  return createElement("p", null, "Loading tracking session");
};

it.effect(
  "server rendering keeps a stable initial tracking state without reading the bridge",
  () =>
    Effect.sync(() => {
      let reads = 0;

      const layer = bridgeLayer(() => {
        reads += 1;

        Effect.runSync(Effect.succeed(undefined));
      });

      const render = () =>
        renderToString(
          createElement(RadicalProvider, { layer }, createElement(Screen))
        );

      assert.strictEqual(render(), "<p>Loading tracking session</p>");
      assert.strictEqual(render(), "<p>Loading tracking session</p>");
      assert.strictEqual(reads, 0);
    })
);
