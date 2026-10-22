import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { cameraDeclarations } from "../../vite/camera-declarations.ts";

const pluginOptions = {
  Camera: {
    usageDescription: "Take <photos> & preview",
    photoLibraryUsageDescription: "Choose <photos>",
  },
  VideoStream: { usageDescription: "Scan <QR> & preview" },
};

for (const { name, internalPlugins, purpose, photoLibrary } of [
  {
    name: "camera only",
    internalPlugins: { camera: true },
    purpose: "Take &lt;photos&gt; &amp; preview",
    photoLibrary: true,
  },
  {
    name: "video only",
    internalPlugins: { videoStream: true },
    purpose: "Scan &lt;QR&gt; &amp; preview",
    photoLibrary: false,
  },
  {
    name: "both enabled",
    internalPlugins: { camera: true, videoStream: true },
    purpose: "Take &lt;photos&gt; &amp; preview Scan &lt;QR&gt; &amp; preview",
    photoLibrary: true,
  },
]) {
  it.effect(`emits one shared camera declaration for ${name}`, () =>
    Effect.gen(function* () {
      const declarations = yield* cameraDeclarations({
        appId: "dev.test.app",
        internalPlugins,
        pluginOptions,
      });
      assert.strictEqual(
        declarations.android,
        '<uses-permission android:name="android.permission.CAMERA" /><uses-feature android:name="android.hardware.camera" android:required="false" />'
      );
      assert.strictEqual(
        declarations.ios,
        `<key>NSCameraUsageDescription</key><string>${purpose}</string>${photoLibrary ? "<key>NSPhotoLibraryUsageDescription</key><string>Choose &lt;photos&gt;</string>" : ""}`
      );
    })
  );
}

it.effect("deduplicates identical camera purposes before XML escaping", () =>
  Effect.gen(function* () {
    const declarations = yield* cameraDeclarations({
      appId: "dev.test.app",
      internalPlugins: { camera: true, videoStream: true },
      pluginOptions: {
        ...pluginOptions,
        VideoStream: {
          usageDescription: pluginOptions.Camera.usageDescription,
        },
      },
    });
    assert.strictEqual(
      declarations.ios,
      "<key>NSCameraUsageDescription</key><string>Take &lt;photos&gt; &amp; preview</string><key>NSPhotoLibraryUsageDescription</key><string>Choose &lt;photos&gt;</string>"
    );
  })
);
