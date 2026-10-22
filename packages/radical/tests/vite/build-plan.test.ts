import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { definePlugin } from "../../src/core/plugins/plugins.ts";
import {
  composePlist,
  composeSettings,
  resolveBuildPlan,
} from "../../src/vite/build-plan.ts";
import { PluginModules } from "../../src/vite/plugins/plugin-plan.ts";

const modules = Layer.succeed(PluginModules, {
  load: () => Effect.sync(() => assert.fail("Unexpected manifest load")),
});
const options = {
  Camera: {
    usageDescription: "Take <photos> & preview",
    photoLibraryUsageDescription: "Choose photos",
  },
  VideoStream: { usageDescription: "Scan QR codes" },
  GoogleSignIn: {
    webClientId: "web.apps.googleusercontent.com",
    iosClientId: "ios.apps.googleusercontent.com",
  },
};
const resolve = (input: Schema.Json) =>
  resolveBuildPlan(input).pipe(Effect.provide(modules));

it.effect(
  "resolves implied capabilities and all native contributions before generation",
  () =>
    Effect.gen(function* () {
      const plan = yield* resolve({
        appId: "dev.test.app",
        internalPlugins: {
          camera: true,
          videoStream: true,
          googleSignIn: true,
          pushNotifications: true,
          notifications: false,
          network: false,
        },
        pluginOptions: options,
        notifications: {
          android: { googleServices: "firebase.json" },
          ios: {
            googleServiceInfo: "firebase.plist",
            environment: "production",
          },
        },
      });
      assert.deepStrictEqual(plan.capabilities, [
        "googleSignIn",
        "network",
        "notifications",
        "pushNotifications",
        "videoStream",
        "camera",
        "device",
        "transitions",
      ]);
      assert.deepStrictEqual(plan.options, {
        camera: options.Camera,
        videoStream: options.VideoStream,
        googleSignIn: options.GoogleSignIn,
      });
      assert.deepStrictEqual(plan.pluginConfig, {
        GoogleSignIn: options.GoogleSignIn,
        CameraPreview: options.VideoStream,
        Camera: options.Camera,
      });
      assert.deepStrictEqual(plan.android.declarations, [
        '<uses-permission android:name="android.permission.CAMERA" />',
        '<uses-feature android:name="android.hardware.camera" android:required="false" />',
      ]);
      assert.deepStrictEqual(plan.ios.plist, {
        NSCameraUsageDescription:
          "<string>Take &lt;photos&gt; &amp; preview Scan QR codes</string>",
        NSPhotoLibraryUsageDescription: "<string>Choose photos</string>",
        GIDClientID: "<string>ios.apps.googleusercontent.com</string>",
        CFBundleURLTypes:
          "<array><dict><key>CFBundleURLSchemes</key><array><string>com.googleusercontent.apps.ios</string></array></dict></array>",
        UIBackgroundModes:
          "<array><string>remote-notification</string></array>",
      });
      assert.deepStrictEqual(plan.ios.entitlements, {
        "aps-environment": "<string>production</string>",
      });
      assert.strictEqual(plan.ios.appDelegateHooks.length, 1);
      assert.include(
        plan.ios.appDelegateHooks[0] ?? "",
        "capacitorDidRegisterForRemoteNotifications"
      );
      assert.include(
        plan.ios.appDelegateHooks[0] ?? "",
        "capacitorDidFailToRegisterForRemoteNotifications"
      );
      assert.include(
        plan.ios.appDelegateHooks[0] ?? "",
        "didReceiveRemoteNotification"
      );
      assert.deepStrictEqual(plan.defines, {
        __RADICAL_GOOGLE_SIGN_IN__: JSON.stringify(options.GoogleSignIn),
      });
      assert.deepStrictEqual(plan.spm, {
        "@capacitor-firebase/messaging": { symlink: true },
      });
      assert.deepStrictEqual(plan.copies, [
        {
          platform: "android",
          source: "firebase.json",
          file: "android/app/google-services.json",
        },
        {
          platform: "ios",
          source: "firebase.plist",
          file: "ios/App/App/GoogleService-Info.plist",
        },
      ]);
    })
);

it.effect(
  "ignores disabled capability options and omits their native contributions",
  () =>
    Effect.gen(function* () {
      const plan = yield* resolve({
        appId: "dev.test.app",
        pluginOptions: { Camera: false, VideoStream: null, GoogleSignIn: {} },
      });
      assert.deepStrictEqual(plan.capabilities, ["device", "transitions"]);
      assert.deepStrictEqual(plan.pluginConfig, {});
      assert.deepStrictEqual(plan.android.declarations, []);
      assert.deepStrictEqual(plan.ios.plist, {});
      assert.deepStrictEqual(plan.ios.entitlements, {});
      assert.deepStrictEqual(plan.ios.appDelegateHooks, []);
      assert.deepStrictEqual(plan.spm, {});
      assert.deepStrictEqual(plan.edits, []);
      assert.deepStrictEqual(plan.files, []);
      assert.deepStrictEqual(plan.copies, []);
      assert.deepStrictEqual(plan.defines, {
        __RADICAL_GOOGLE_SIGN_IN__: "null",
      });
    })
);

it.effect("deduplicates identical shared camera purposes before escaping", () =>
  Effect.gen(function* () {
    const plan = yield* resolve({
      appId: "dev.test.app",
      internalPlugins: { camera: true, videoStream: true },
      pluginOptions: {
        ...options,
        VideoStream: { usageDescription: options.Camera.usageDescription },
      },
    });
    assert.strictEqual(
      plan.ios.plist.NSCameraUsageDescription,
      "<string>Take &lt;photos&gt; &amp; preview</string>"
    );
    assert.strictEqual(plan.android.declarations.length, 2);
  })
);

for (const [flag, selector, field] of [
  ["camera", "Camera", "usageDescription"],
  ["camera", "Camera", "photoLibraryUsageDescription"],
  ["videoStream", "VideoStream", "usageDescription"],
  ["googleSignIn", "GoogleSignIn", "webClientId"],
  ["googleSignIn", "GoogleSignIn", "iosClientId"],
] as const) {
  it.effect(
    `names pluginOptions.${selector}.${field} when decoding fails`,
    () =>
      Effect.gen(function* () {
        const error = yield* resolve({
          appId: "dev.test.app",
          internalPlugins: { [flag]: true },
          pluginOptions: {
            ...options,
            [selector]: { ...options[selector], [field]: "" },
          },
        }).pipe(Effect.flip);
        assert.strictEqual(error._tag, "InvalidPlugin");
        assert.include(error.message, selector);
        assert.include(error.message, field);
      })
  );
}

it.effect(
  "decodes custom options once and retains the decoded value in the plan",
  () =>
    Effect.gen(function* () {
      let decodes = 0;
      const manifest = definePlugin({
        id: "custom",
        bridge: "Custom",
        dependencies: {},
        config: {
          selector: "Custom",
          schema: Schema.Struct({
            count: Schema.NumberFromString.check(
              Schema.makeFilter(() => {
                decodes += 1;
                return true;
              })
            ),
          }),
        },
        commands: {
          echo: { args: Schema.Struct({}), result: Schema.Unknown, errors: {} },
        },
      });
      const plan = yield* resolveBuildPlan({
        appId: "dev.test.app",
        plugins: [{ manifest: "./custom.ts" }],
        pluginOptions: { Custom: { count: "42" } },
      }).pipe(
        Effect.provideService(PluginModules, {
          load: () => Effect.succeed({ default: manifest }),
        })
      );
      assert.strictEqual(decodes, 1);
      assert.deepStrictEqual(
        plan.plugins.find((entry) => entry.manifest.id === "custom")?.options,
        { count: 42 }
      );
      assert.deepStrictEqual(plan.pluginConfig.Custom, { count: "42" });
    })
);

it.effect(
  "rejects conflicting plist values and incompatible composition rules by key",
  () =>
    Effect.gen(function* () {
      for (const second of [
        { key: "Usage", value: "other" },
        { key: "Usage", value: "same", composition: "unique-purpose" as const },
      ]) {
        const error = yield* composePlist([
          { key: "Usage", value: "same" },
          second,
        ]).pipe(Effect.flip);
        assert.strictEqual(error._tag, "InvalidConfig");
        assert.include(error.message, "Usage");
      }
      assert.deepStrictEqual(
        yield* composePlist([
          { key: "Usage", value: "same" },
          { key: "Usage", value: "same" },
        ]),
        { Usage: "same" }
      );
    })
);

it.effect(
  "deduplicates equal settings and rejects conflicting settings by key",
  () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* composeSettings("SPM setting", [
          { package: { symlink: true } },
          { package: { symlink: true } },
        ]),
        { package: { symlink: true } }
      );
      for (const kind of ["Vite define", "SPM setting", "iOS entitlement"]) {
        const error = yield* composeSettings(kind, [
          { field: "one" },
          { field: "two" },
        ]).pipe(Effect.flip);
        assert.include(error.message, kind);
        assert.include(error.message, "field");
      }
    })
);
