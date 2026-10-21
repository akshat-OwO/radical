import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import type { Bridge } from "../src/bridge.ts";
import { BridgeCallFailed, bridgeTestLayer } from "../src/bridge.ts";
import { BrowserCamera } from "../src/browser-camera.ts";
import { cameraDeclarations } from "../src/camera-declarations.ts";
import {
  capturePhoto,
  choosePhoto,
  checkCameraPermission,
  requestCameraPermission,
  PermissionDenied,
  Cancelled,
  Unavailable,
} from "../src/camera.ts";
import { PluginModules, resolvePlugins } from "../src/plugin-plan.ts";

const image = "data:image/jpeg;base64,aGVsbG8=";
const browserLayer = (overrides: Partial<BrowserCamera["Service"]> = {}) =>
  Layer.succeed(BrowserCamera, {
    choose: Effect.succeed(new Blob(["hello"], { type: "image/jpeg" })),
    capture: Effect.succeed(new Blob(["hello"], { type: "image/jpeg" })),
    check: Effect.succeed("prompt" as const),
    request: Effect.succeed("granted" as const),
    readNative: () =>
      Effect.succeed(new Blob(["hello"], { type: "image/jpeg" })),
    dataUrl: () => Effect.succeed(image),
    ...overrides,
  });
const unexpected = () =>
  Effect.sync(() => assert.fail("Unexpected native call"));

describe("camera", () => {
  it.effect(
    "normalizes native photos in both shells using manifest commands",
    () =>
      Effect.gen(function* () {
        for (const runtime of ["ios", "android"] as const) {
          const calls: unknown[] = [];
          const bridge = bridgeTestLayer(runtime, (plugin, method, options) =>
            Effect.sync(() => {
              calls.push({ plugin, method, options });
              return method === "requestPermissions"
                ? { camera: "granted" }
                : {
                    uri: "file:///photo.jpg",
                    metadata: { format: "jpg", resolution: "640x480" },
                  };
            })
          );
          const result = yield* capturePhoto.pipe(
            Effect.provide(
              Layer.merge(
                bridge,
                browserLayer({
                  readNative: (uri) =>
                    Effect.sync(() => {
                      assert.strictEqual(uri, "file:///photo.jpg");
                      return new Blob();
                    }),
                })
              )
            )
          );
          assert.deepStrictEqual(result, {
            dataUrl: image,
            mimeType: "image/jpeg",
            width: 640,
            height: 480,
          });
          assert.deepStrictEqual(calls, [
            {
              plugin: "Camera",
              method: "requestPermissions",
              options: { permissions: ["camera"] },
            },
            {
              plugin: "Camera",
              method: "takePhoto",
              options: { saveToGallery: false, includeMetadata: true },
            },
          ]);
        }
      })
  );
  it.effect(
    "selects a single library photo without requesting camera permission",
    () =>
      Effect.gen(function* () {
        const methods: string[] = [];
        const result = yield* choosePhoto.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("ios", (_plugin, method, options) =>
                Effect.sync(() => {
                  methods.push(method);
                  assert.deepStrictEqual(options, {
                    mediaType: 0,
                    allowMultipleSelection: false,
                    includeMetadata: true,
                  });
                  return {
                    results: [{ uri: "file:///library.jpg", metadata: {} }],
                  };
                })
              ),
              browserLayer()
            )
          )
        );
        assert.deepStrictEqual(methods, ["chooseFromGallery"]);
        assert.deepStrictEqual(result, {
          dataUrl: image,
          mimeType: "image/jpeg",
        });
        const cancelled = yield* choosePhoto.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("ios", () => Effect.succeed({ results: [] })),
              browserLayer()
            )
          ),
          Effect.flip
        );
        assert.instanceOf(cancelled, Cancelled);
      })
  );
  it.effect(
    "normalizes browser photos without calling the bridge or requesting permission",
    () =>
      Effect.gen(function* () {
        const result = yield* capturePhoto.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("browser", unexpected),
              browserLayer({ request: unexpected(), readNative: unexpected })
            )
          )
        );
        assert.deepStrictEqual(result, {
          dataUrl: image,
          mimeType: "image/jpeg",
        });
      })
  );
  it.effect(
    "reports denial on check and fails requests and capture with PermissionDenied",
    () =>
      Effect.gen(function* () {
        const bridge = bridgeTestLayer("ios", (_plugin, method) =>
          Effect.sync(() => {
            assert.notStrictEqual(method, "takePhoto");
            return { camera: "denied" };
          })
        );
        const provide = <A, E>(
          effect: Effect.Effect<A, E, Bridge | BrowserCamera>
        ) => effect.pipe(Effect.provide(Layer.merge(bridge, browserLayer())));
        assert.strictEqual(yield* provide(checkCameraPermission), "denied");
        assert.instanceOf(
          yield* Effect.flip(provide(requestCameraPermission)),
          PermissionDenied
        );
        assert.instanceOf(
          yield* Effect.flip(provide(capturePhoto)),
          PermissionDenied
        );
      })
  );
  it.effect(
    "maps known native errors and preserves unknown bridge failures",
    () =>
      Effect.gen(function* () {
        for (const [code, tag] of [
          ["OS-PLUG-CAMR-0003", "PermissionDenied"],
          ["OS-PLUG-CAMR-0006", "Cancelled"],
          ["OS-PLUG-CAMR-0007", "Unavailable"],
          ["OTHER", "BridgeCallFailed"],
        ]) {
          const error = yield* capturePhoto.pipe(
            Effect.provide(
              Layer.merge(
                bridgeTestLayer("android", (plugin, method) =>
                  method === "requestPermissions"
                    ? Effect.succeed({ camera: "granted" })
                    : Effect.fail(
                        new BridgeCallFailed({
                          plugin,
                          method,
                          cause: { code },
                        })
                      )
                ),
                browserLayer()
              )
            ),
            Effect.flip
          );
          assert.strictEqual(error._tag, tag);
        }
      })
  );
  it.effect("rejects malformed native results at the bridge boundary", () =>
    Effect.gen(function* () {
      const error = yield* checkCameraPermission.pipe(
        Effect.provide(
          Layer.merge(
            bridgeTestLayer("ios", () => Effect.succeed({ camera: "invalid" })),
            browserLayer()
          )
        ),
        Effect.flip
      );
      assert.strictEqual(error._tag, "BridgeDecodeError");
    })
  );
  it.effect("normalizes Android rationale to prompt", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* checkCameraPermission.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("android", () =>
                Effect.succeed({ camera: "prompt-with-rationale" })
              ),
              browserLayer()
            )
          )
        ),
        "prompt"
      );
    })
  );
  it.effect(
    "preserves typed browser cancellation and rejects non-image results",
    () =>
      Effect.gen(function* () {
        const bridge = bridgeTestLayer("browser", unexpected);
        const error = yield* capturePhoto.pipe(
          Effect.provide(
            Layer.merge(
              bridge,
              browserLayer({ capture: Effect.fail(new Cancelled({})) })
            )
          ),
          Effect.flip
        );
        assert.instanceOf(error, Cancelled);
        const invalid = yield* capturePhoto.pipe(
          Effect.provide(
            Layer.merge(
              bridge,
              browserLayer({
                dataUrl: () => Effect.succeed("data:text/plain;base64,aA=="),
              })
            )
          ),
          Effect.flip
        );
        assert.instanceOf(invalid, Unavailable);
      })
  );
  it.effect(
    "interrupts pending capture before its TestClock deadline and releases resources",
    () =>
      Effect.gen(function* () {
        let released = false;
        const fiber = yield* capturePhoto.pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("browser", unexpected),
              browserLayer({
                capture: Effect.sleep("1 minute").pipe(
                  Effect.andThen(Effect.succeed(new Blob())),
                  Effect.ensuring(
                    Effect.sync(() => {
                      released = true;
                    })
                  )
                ),
              })
            )
          ),
          Effect.forkChild
        );
        yield* TestClock.adjust("30 seconds");
        yield* Fiber.interrupt(fiber);
        yield* TestClock.adjust("1 minute");
        assert.isTrue(released);
      })
  );
});

describe("camera enablement", () => {
  it.effect("omits camera dependencies and declarations by default", () =>
    Effect.gen(function* () {
      const config = { appId: "dev.test.app" };
      const plugins = yield* resolvePlugins(config).pipe(
        Effect.provideService(PluginModules, { load: unexpected })
      );
      assert.isFalse(plugins.some(({ manifest }) => manifest.id === "camera"));
      assert.deepStrictEqual(yield* cameraDeclarations(config), {
        android: "",
        ios: "",
      });
    })
  );
  it.effect(
    "requires explicit nonblank usage text and escapes plist content",
    () =>
      Effect.gen(function* () {
        const config = {
          appId: "dev.test.app",
          internalPlugins: { camera: true },
        };
        for (const usageDescription of [
          undefined,
          "",
          "   ",
          "bad\u0001text",
        ]) {
          const invalid = {
            ...config,
            pluginOptions: {
              Camera: {
                usageDescription,
                photoLibraryUsageDescription: "Choose photos",
              },
            },
          };
          assert.strictEqual(
            (yield* Effect.flip(
              resolvePlugins(invalid).pipe(
                Effect.provideService(PluginModules, { load: unexpected })
              )
            ))._tag,
            "InvalidPlugin"
          );
          assert.strictEqual(
            (yield* Effect.flip(cameraDeclarations(invalid)))._tag,
            "InvalidConfig"
          );
        }
        for (const photoLibraryUsageDescription of [
          undefined,
          "",
          "   ",
          "bad\u0001text",
        ]) {
          const invalid = {
            ...config,
            pluginOptions: {
              Camera: {
                usageDescription: "Take photos",
                photoLibraryUsageDescription,
              },
            },
          };
          assert.strictEqual(
            (yield* cameraDeclarations(invalid).pipe(Effect.flip))._tag,
            "InvalidConfig"
          );
        }
        const valid = {
          ...config,
          pluginOptions: {
            Camera: {
              usageDescription: "Take <photos> & preview",
              photoLibraryUsageDescription: "Choose <photos>",
            },
          },
        };
        const plugins = yield* resolvePlugins(valid).pipe(
          Effect.provideService(PluginModules, { load: unexpected })
        );
        assert.deepStrictEqual(
          plugins.find(({ manifest }) => manifest.id === "camera")?.manifest
            .dependencies,
          { "@capacitor/camera": "8.2.6" }
        );
        const declarations = yield* cameraDeclarations(valid);
        assert.include(declarations.android, "android.permission.CAMERA");
        assert.include(declarations.android, 'android:required="false"');
        assert.strictEqual(
          declarations.ios,
          "<key>NSCameraUsageDescription</key><string>Take &lt;photos&gt; &amp; preview</string><key>NSPhotoLibraryUsageDescription</key><string>Choose &lt;photos&gt;</string>"
        );
      })
  );
});
