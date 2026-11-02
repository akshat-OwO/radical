import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { defaultWindowLayout } from "../../src/core/context/native-context.ts";
import { RadicalProvider, Splash } from "../../src/react/react.ts";

const render = (platform?: "android" | "ios") =>
  renderToString(
    createElement(
      RadicalProvider,
      platform === undefined
        ? {}
        : {
            nativeContext: {
              platform,
              safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
              windowLayout: defaultWindowLayout,
              shellVersion: "1.0.0",
            },
          },
      createElement(Splash, {
        splash: { backgroundColor: "#241044" },
        style: { opacity: 0.5 },
      })
    )
  );

it.effect("renders nothing in a browser", () =>
  Effect.sync(() => {
    assert.strictEqual(render(), "");
  })
);

it.effect(
  "server-renders the platform's splash geometry over the page in a shell",
  () =>
    Effect.sync(() => {
      const ios = render("ios");
      const android = render("android");

      for (const html of [ios, android]) {
        assert.include(html, "position:fixed");
        assert.include(html, "background:#241044");
        assert.include(html, "opacity:0.5");
      }

      assert.include(ios, "width:calc(max(100vw, 100vh) * 768 / 2732)");
      assert.include(android, "width:180px");
    })
);
