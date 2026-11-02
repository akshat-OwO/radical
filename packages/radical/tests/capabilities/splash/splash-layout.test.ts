import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  radicalMarkSvg,
  splashLayout,
} from "../../../src/capabilities/splash/splash-layout.ts";
import mark from "../../../templates/radical-mark.svg?raw";

it.effect("draws the same Radical logo that native generation renders", () =>
  Effect.sync(() => {
    assert.strictEqual(radicalMarkSvg, mark);
  })
);

it.effect(
  "centers the default logo at its share of the iOS screen and the Android icon",
  () =>
    Effect.sync(() => {
      const splash = { backgroundColor: "#ffffff" };
      const ios = splashLayout(splash, "ios");
      const android = splashLayout(splash, "android");

      assert.strictEqual(ios.backgroundColor, "#ffffff");
      assert.strictEqual(ios.size, "calc(max(100vw, 100vh) * 768 / 2732)");
      assert.strictEqual(android.size, "180px");
      assert.strictEqual(ios.image, android.image);
      assert.include(
        ios.image,
        `data:image/svg+xml,${encodeURIComponent(mark)}`
      );
    })
);

it.effect(
  "fills the iOS screen with a configured image and sizes it as the Android icon",
  () =>
    Effect.sync(() => {
      const splash = {
        image: "/assets/splash.png",
        backgroundColor: "#241044",
      };

      assert.deepStrictEqual(splashLayout(splash, "ios"), {
        backgroundColor: "#241044",
        image: 'url("/assets/splash.png")',
        size: "max(100vw, 100vh)",
      });
      assert.deepStrictEqual(splashLayout(splash, "android"), {
        backgroundColor: "#241044",
        image: 'url("/assets/splash.png")',
        size: "288px",
      });
    })
);
