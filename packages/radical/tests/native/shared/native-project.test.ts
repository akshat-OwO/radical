import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  nativeCookiePlan,
  renderTemplate,
} from "../../../src/native/shared/native-project.ts";
import { replaceAnchor } from "../../../src/native/shared/native-template.ts";

describe("native cookie plan", () => {
  it.effect("shares one non-Secure cookie across mixed schemes and ports", () =>
    Effect.sync(() => {
      const origins = [
        "https://app.test",
        "http://app.test:3000",
        "https://app.test:8443",
        "https://secure.test",
        "https://secure.test:8443",
      ];

      const expected = [
        { hostname: "app.test", origin: "http://app.test:3000", secure: false },
        {
          hostname: "secure.test",
          origin: "https://secure.test",
          secure: true,
        },
      ];

      assert.deepStrictEqual(nativeCookiePlan(origins), expected);
      assert.deepStrictEqual(nativeCookiePlan(origins.toReversed()), expected);
    })
  );
  it.effect("deduplicates HTTP ports without setting Secure", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        nativeCookiePlan(["http://local.test:3000", "http://local.test:4000"]),
        [
          {
            hostname: "local.test",
            origin: "http://local.test:4000",
            secure: false,
          },
        ]
      );
    })
  );
});

describe("native template anchors", () => {
  it.effect("reports the file and missing string or regex anchor", () =>
    Effect.gen(function* () {
      for (const anchor of [
        "CAPBridgeViewController()",
        /<\/dict>\s*<\/plist>/u,
      ]) {
        const error = yield* Effect.flip(
          replaceAnchor(
            "App/template",
            "changed upstream",
            anchor,
            "replacement"
          )
        );

        assert.strictEqual(error._tag, "NativeTemplateMismatch");
        assert.strictEqual(error.file, "App/template");
        assert.strictEqual(error.anchor, String(anchor));
      }

      const error = yield* Effect.flip(
        renderTemplate("MainActivity.java", "changed upstream", {
          __COOKIES__: "cookie code",
        })
      );

      assert.strictEqual(error.file, "MainActivity.java");
      assert.strictEqual(error.anchor, "__COOKIES__");
    })
  );
});
