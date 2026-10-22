// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import { cameraDeclarations } from "../../../src/capabilities/camera/camera-declarations.ts";
import {
  BrowserVideoStream,
  presentVideoStream,
  requestVideoMedia,
} from "../../../src/capabilities/video-stream/browser-video-stream.ts";
import { startVideoStream } from "../../../src/capabilities/video-stream/video-stream.ts";
import {
  Bridge,
  BridgeCallFailed,
  bridgeLayer,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";

const presentation = Layer.succeed(BrowserVideoStream, {
  start: () => Effect.die("Unexpected browser start"),
  present: presentVideoStream,
});
const nativeFixture = () => {
  const calls: { method: string; args: Readonly<Record<string, unknown>> }[] =
    [];
  let receive: ((value: unknown) => void) | undefined;
  let removed = false;
  const layer = Layer.succeed(Bridge, {
    runtime: Effect.succeed("android" as const),
    observe: () => Effect.succeed(() => {}),
    listen: (_plugin, _event, listener) =>
      Effect.sync(() => {
        receive = listener;
        return Effect.sync(() => {
          removed = true;
        });
      }),
    call: (_plugin, method, args) =>
      Effect.sync(() => {
        calls.push({ method, args });
        if (method === "requestPermissions") {
          return { camera: "granted" };
        }
        if (method === "getAvailableDevices") {
          return { devices: [{}] };
        }
        if (method === "getZoom") {
          return { min: 1, max: 8, current: 1 };
        }
        if (method === "getSupportedFlashModes") {
          return { result: ["off", "torch"] };
        }
        if (method === "getVideoFrameRate") {
          return { frameRate: 30 };
        }
        return {};
      }),
  });
  return {
    layer,
    calls,
    emit: (value: unknown) => receive?.(value),
    removed: () => removed,
  };
};
it.effect(
  "routes QR events, switches cameras, and sends zoom and torch commands",
  () =>
    Effect.gen(function* () {
      const fixture = nativeFixture();
      const values: string[] = [];
      const viewfinder = document.createElement("div");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* startVideoStream({
            viewfinder,
            onDetect: (value) => {
              values.push(value);
            },
          });
          fixture.emit({
            barcodes: [
              { format: "qr_code", value: "hello" },
              { format: "ean_8", value: "ignored" },
            ],
          });
          fixture.emit({ barcodes: "invalid" });
          assert.deepStrictEqual(values, ["hello"]);
          assert.deepStrictEqual(yield* session.info, {
            facing: "rear",
            zoom: { min: 1, max: 8, current: 1 },
            torch: false,
            torchAvailable: true,
            frameRate: 30,
            detectionAvailable: true,
          });
          yield* session.setZoom(2);
          yield* session.setTorch(true);
          assert.isTrue((yield* session.info).torch);
          yield* session.switchCamera;
          assert.strictEqual((yield* session.info).facing, "front");
          assert.isFalse((yield* session.info).torch);
          assert.strictEqual(
            (yield* session.setZoom(Number.NaN).pipe(Effect.flip))._tag,
            "Unavailable"
          );
        })
      ).pipe(Effect.provide([fixture.layer, presentation]));
      assert.isTrue(fixture.removed());
      assert.strictEqual(fixture.calls.at(-1)?.method, "stop");
      assert.deepStrictEqual(
        fixture.calls.find((call) => call.method === "setZoom")?.args,
        { level: 2 }
      );
      assert.deepStrictEqual(
        fixture.calls.find((call) => call.method === "setFlashMode")?.args,
        { flashMode: "torch" }
      );
    })
);
it.effect(
  "restores ancestor backgrounds and leaves sibling overlays unchanged",
  () =>
    Effect.gen(function* () {
      const parent = document.createElement("section");
      parent.style.setProperty("background", "red", "important");
      const hole = document.createElement("div");
      const overlay = document.createElement("aside");
      overlay.style.background = "blue";
      parent.append(hole, overlay);
      const restore = yield* presentVideoStream(hole);
      assert.strictEqual(parent.style.background, "transparent");
      assert.strictEqual(overlay.style.background, "blue");
      restore();
      assert.strictEqual(parent.style.background, "red");
      assert.strictEqual(
        parent.style.getPropertyPriority("background"),
        "important"
      );
      assert.strictEqual(hole.style.background, "");
    })
);
it.effect("denied native permission never starts a preview", () =>
  Effect.gen(function* () {
    const methods: string[] = [];
    const error = yield* Effect.scoped(
      startVideoStream({ viewfinder: document.createElement("div") })
    ).pipe(
      Effect.provide([
        presentation,
        bridgeTestLayer("ios", (_plugin, method) =>
          Effect.sync(() => {
            methods.push(method);
            return { camera: "denied" };
          })
        ),
      ]),
      Effect.flip
    );
    assert.strictEqual(error._tag, "PermissionDenied");
    assert.deepStrictEqual(methods, ["requestPermissions"]);
  })
);
it.effect(
  "interruption waits for native acquisition then stops the late preview",
  () =>
    Effect.gen(function* () {
      const fixture = nativeFixture();
      const original = yield* Effect.service(Bridge).pipe(
        Effect.provide(fixture.layer)
      );
      const started = yield* Deferred.make<boolean>();
      const stopped = yield* Deferred.make<boolean>();
      const methods: string[] = [];
      const layer = Layer.succeed(Bridge, {
        ...original,
        call: (plugin, method, args) => {
          methods.push(method);
          if (method === "start") {
            return Deferred.succeed(started, true).pipe(
              Effect.andThen(Effect.sleep("1 second"))
            );
          }
          if (method === "stop") {
            return Deferred.succeed(stopped, true);
          }
          return original.call(plugin, method, args);
        },
      });
      const fiber = yield* Effect.scoped(
        startVideoStream({ viewfinder: document.createElement("div") }).pipe(
          Effect.andThen(Effect.never)
        )
      ).pipe(Effect.provide([presentation, layer]), Effect.forkChild);
      yield* Deferred.await(started);
      const interrupt = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      yield* Deferred.await(stopped);
      yield* Fiber.join(interrupt);
      assert.deepStrictEqual(
        methods.filter((method) => method === "start" || method === "stop"),
        ["start", "stop"]
      );
      assert.isTrue(fixture.removed());
    })
);
it.effect(
  "browser sessions use the injectable service and release on scope exit",
  () =>
    Effect.gen(function* () {
      let released = false;
      const info = {
        facing: "rear" as const,
        torch: false,
        torchAvailable: false,
        detectionAvailable: false,
      };
      const browser = Layer.succeed(BrowserVideoStream, {
        present: presentVideoStream,
        start: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                released = true;
              })
            );
            return {
              info: Effect.succeed(info),
              switchCamera: Effect.void,
              setZoom: () => Effect.void,
              setTorch: () => Effect.void,
            };
          }),
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* startVideoStream({
            viewfinder: document.createElement("div"),
          });
          assert.deepStrictEqual(yield* session.info, info);
        })
      ).pipe(
        Effect.provide([
          browser,
          bridgeTestLayer("browser", () =>
            Effect.die("Browser called native bridge")
          ),
        ])
      );
      assert.isTrue(released);
    })
);
it.effect(
  "video opt-in validates its own explanation without photo-library access",
  () =>
    Effect.gen(function* () {
      const config = {
        appId: "dev.test.app",
        internalPlugins: { videoStream: true },
        pluginOptions: { VideoStream: { usageDescription: "Scan <QR>" } },
      };
      const declarations = yield* cameraDeclarations(config);
      assert.include(declarations.android, "android.permission.CAMERA");
      assert.include(declarations.ios, "Scan &lt;QR&gt;");
      assert.notInclude(declarations.ios, "NSPhotoLibraryUsageDescription");
      assert.strictEqual(
        (yield* cameraDeclarations({ ...config, pluginOptions: {} }).pipe(
          Effect.flip
        ))._tag,
        "InvalidConfig"
      );
    })
);

it.effect(
  "stops browser media that resolves after acquisition is interrupted",
  () =>
    Effect.gen(function* () {
      let stopped = 0;
      let accepted = false;
      const requested = yield* Deferred.make<boolean>();
      const result = yield* Deferred.make<{
        getTracks: () => { stop: () => void }[];
      }>();
      const late = Effect.runPromise(Deferred.await(result));
      const fiber = yield* requestVideoMedia(
        async () => {
          Effect.runSync(Deferred.succeed(requested, true));
          return await late;
        },
        () => {
          accepted = true;
        }
      ).pipe(Effect.forkChild);
      yield* Deferred.await(requested);
      yield* Fiber.interrupt(fiber);
      yield* Deferred.succeed(result, {
        getTracks: () => [
          {
            stop: () => {
              stopped += 1;
            },
          },
        ],
      });
      yield* Effect.promise(async () => await late);
      assert.strictEqual(stopped, 1);
      assert.isFalse(accepted);
    })
);
it.effect("reports Unavailable when the native camera list is empty", () =>
  Effect.gen(function* () {
    const error = yield* Effect.scoped(
      startVideoStream({ viewfinder: document.createElement("div") })
    ).pipe(
      Effect.provide([
        presentation,
        bridgeTestLayer("ios", (_plugin, method) =>
          Effect.succeed(
            method === "requestPermissions"
              ? { camera: "granted" }
              : { devices: [] }
          )
        ),
      ]),
      Effect.flip
    );
    assert.strictEqual(error._tag, "Unavailable");
  })
);

it.effect(
  "restores background longhands without undoing other style changes",
  () =>
    Effect.gen(function* () {
      const hole = document.createElement("div");
      hole.style.setProperty("background-color", "red");
      hole.style.setProperty("background-image", 'url("test.png")');
      const before = hole.style.cssText;
      const restore = yield* presentVideoStream(hole);
      hole.style.setProperty("color", "blue");
      restore();
      assert.strictEqual(hole.style.color, "blue");
      hole.style.removeProperty("color");
      assert.strictEqual(hole.style.cssText, before);
    })
);
it.effect(
  "failed native startup stops partial resources and restores presentation",
  () =>
    Effect.gen(function* () {
      const fixture = nativeFixture();
      const original = yield* Effect.service(Bridge).pipe(
        Effect.provide(fixture.layer)
      );
      const layer = Layer.succeed(Bridge, {
        ...original,
        call: (plugin, method, args) =>
          method === "start"
            ? Effect.fail(
                new BridgeCallFailed({
                  plugin,
                  method,
                  cause: { code: "cameraPermissionDenied" },
                })
              )
            : original.call(plugin, method, args),
      });
      const hole = document.createElement("div");
      hole.style.backgroundColor = "red";
      const error = yield* Effect.scoped(
        startVideoStream({ viewfinder: hole })
      ).pipe(Effect.provide([presentation, layer]), Effect.flip);
      assert.strictEqual(error._tag, "PermissionDenied");
      assert.strictEqual(hole.style.backgroundColor, "red");
      assert.strictEqual(fixture.calls.at(-1)?.method, "stop");
      assert.isTrue(fixture.removed());
    })
);

it.effect(
  "removes native listeners without awaiting RETURN_NONE and ignores late events",
  () =>
    Effect.gen(function* () {
      const methods: string[] = [];
      const values: unknown[] = [];
      let emit: ((value: unknown, error?: unknown) => void) | undefined;
      const layer = bridgeLayer(() => ({
        getPlatform: () => "android",
        nativePromise: () =>
          assert.fail("Listener removal must not use nativePromise"),
        nativeCallback: (_plugin, method, _options, receive) => {
          methods.push(method);
          if (method === "addListener") {
            emit = receive;
          }
          return "1";
        },
      }));
      const bridge = yield* Effect.service(Bridge).pipe(Effect.provide(layer));
      assert.isDefined(bridge.listen);
      const remove = yield* bridge.listen(
        "CameraPreview",
        "barcodeScanned",
        (value) => {
          values.push(value);
        }
      );
      emit?.("first");
      yield* remove;
      emit?.("late");
      assert.deepStrictEqual(values, ["first"]);
      assert.deepStrictEqual(methods, ["addListener", "removeListener"]);
    })
);
