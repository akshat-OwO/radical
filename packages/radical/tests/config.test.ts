import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { nativeIdentity, validateConfig } from "../src/config.ts";

describe("radical config", () => {
  it.effect("accepts an app id and optional app name", () =>
    Effect.gen(function* () {
      const config = { appId: "dev.radical.example", appName: "Example" };
      assert.deepStrictEqual(yield* validateConfig(config), config);
      assert.deepStrictEqual(
        yield* validateConfig({ appId: "dev.radical.app" }),
        {
          appId: "dev.radical.app",
        }
      );
    })
  );

  it.effect("rejects malformed app ids with a typed error naming appId", () =>
    Effect.gen(function* () {
      for (const appId of [
        "",
        "example",
        "dev..example",
        "dev.1app",
        "dev.my-app",
        "dev.app\n",
      ]) {
        const error = yield* Effect.flip(validateConfig({ appId }));
        assert.strictEqual(error._tag, "InvalidConfig");
        assert.include(error.message, "appId");
      }
    })
  );

  it.effect("reports a missing appId and an invalid appName by field", () =>
    Effect.gen(function* () {
      const missing = yield* Effect.flip(validateConfig({}));
      assert.include(missing.message, "appId");
      const name = yield* Effect.flip(
        validateConfig({ appId: "dev.radical.app", appName: "" })
      );
      assert.include(name.message, "appName");
    })
  );
  it.effect(
    "accepts exact HTTP origins and rejects unsafe allowlist values",
    () =>
      Effect.gen(function* () {
        const config = {
          appId: "dev.radical.example",
          allowlist: ["https://app.example", "http://192.168.1.2:3000"],
          devHost: "192.168.1.2",
        };
        assert.deepStrictEqual(yield* validateConfig(config), config);
        for (const origin of [
          "*",
          "https://*.example",
          // oxlint-disable-next-line eslint/no-script-url -- Validation fixture for an unsafe scheme.
          "javascript:alert(1)",
          "https://example/path",
          "https://user:password@example",
          "https://example/",
        ]) {
          const result = yield* Effect.flip(
            validateConfig({ appId: config.appId, allowlist: [origin] })
          );
          assert.strictEqual(result._tag, "InvalidConfig");
        }
      })
  );
});

it.effect(
  "resolves shared names, legacy names, platform overrides and default ids",
  () =>
    Effect.gen(function* () {
      const config = yield* validateConfig({
        appId: "dev.example.app",
        appName: "Legacy",
        name: "Shared",
        android: { name: "Android", packageId: "dev.android.app" },
        ios: { bundleId: "dev.ios.my-app" },
      });
      assert.deepStrictEqual(nativeIdentity(config, "android"), {
        appId: "dev.android.app",
        name: "Android",
      });
      assert.deepStrictEqual(nativeIdentity(config, "ios"), {
        appId: "dev.ios.my-app",
        name: "Shared",
      });
      assert.deepStrictEqual(
        nativeIdentity({ appId: "dev.example.app", appName: "Legacy" }, "ios"),
        { appId: "dev.example.app", name: "Legacy" }
      );
      assert.deepStrictEqual(
        nativeIdentity({ appId: "dev.example.app" }, "android"),
        { appId: "dev.example.app", name: "dev.example.app" }
      );
    })
);

it.effect(
  "rejects invalid native ids, empty names and non-RGB splash colours by field",
  () =>
    Effect.gen(function* () {
      for (const [field, value] of [
        ["android", { android: { packageId: "dev.my-app" } }],
        ["android", { android: { packageId: "dev.class.app" } }],
        ["android", { android: { packageId: "dev.1app" } }],
        ["ios", { ios: { bundleId: "dev.my_app" } }],
        ["ios", { ios: { bundleId: "dev..app" } }],
        ["ios", { ios: { bundleId: "dev.app\n" } }],
        ["icon", { icon: { image: "icon.png", backgroundColor: "#fff" } }],
        ["name", { name: "" }],
        ["android", { android: { name: "" } }],
        ["ios", { ios: { name: "" } }],
        ...["red", "#fff", "#ffffffff", "#gg0000", "#123456\n"].map(
          (backgroundColor) =>
            [
              "backgroundColor",
              { splash: { image: "splash.png", backgroundColor } },
            ] as const
        ),
      ] as const) {
        const error = yield* Effect.flip(
          validateConfig({ appId: "dev.example.app", ...value })
        );
        assert.strictEqual(error._tag, "InvalidConfig");
        assert.include(error.message, field);
      }
    })
);
