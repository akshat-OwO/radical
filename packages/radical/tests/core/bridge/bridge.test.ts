import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  Bridge,
  BridgeCallFailed,
  bridgeLayer,
  bridgeTestLayer,
  callBridge,
  detectRuntime,
  DeviceInfoSchema,
  getDeviceInfo,
} from "../../../src/entry/client.ts";

const nativeInfo = {
  platform: "android",
  model: "Pixel 9",
  operatingSystem: "android",
  osVersion: "16",
  manufacturer: "Google",
  isVirtual: true,
};

describe("injected bridge", () => {
  it.effect("detects SSR as browser without a window", () =>
    Effect.sync(() => {
      assert.isFalse("window" in globalThis);
      assert.strictEqual(detectRuntime(), "browser");
    })
  );
  it.effect("detects Android and iOS from the injected bridge", () =>
    Effect.gen(function* () {
      for (const platform of ["android", "ios", "web", "other"]) {
        const runtime = yield* Bridge.pipe(
          Effect.flatMap((bridge) => bridge.runtime),
          Effect.provide(
            bridgeLayer(() => ({
              getPlatform: () => platform,
              nativePromise: async () =>
                await Effect.runPromise(Effect.succeed({})),
            }))
          )
        );
        assert.strictEqual(
          runtime,
          platform === "android" || platform === "ios" ? platform : "browser"
        );
      }
    })
  );
  it.effect(
    "calls the injected nativePromise with its receiver and decodes the result",
    () =>
      Effect.gen(function* () {
        const injected = {
          getPlatform: () => "android",
          async nativePromise(
            plugin: string,
            method: string,
            options: Parameters<Bridge["Service"]["call"]>[2]
          ) {
            assert.strictEqual(this, injected);
            assert.strictEqual(plugin, "Device");
            assert.strictEqual(method, "getInfo");
            assert.deepStrictEqual(options, {});
            return await Effect.runPromise(
              Effect.succeed({
                ...nativeInfo,
                ignored: "native extension",
              })
            );
          },
        };
        assert.deepStrictEqual(
          yield* getDeviceInfo.pipe(
            Effect.provide(bridgeLayer(() => injected))
          ),
          nativeInfo
        );
      })
  );
  it.effect(
    "reports BridgeUnavailable when the native transport is absent",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          callBridge("Device", "getInfo", DeviceInfoSchema).pipe(
            Effect.provide(bridgeLayer(() => {}))
          )
        );
        assert.strictEqual(error._tag, "BridgeUnavailable");
        assert.strictEqual(error.plugin, "Device");
      })
  );
  it.effect("preserves the rejected native cause in BridgeCallFailed", () =>
    Effect.gen(function* () {
      const cause = new Error("UNIMPLEMENTED");
      const error = yield* Effect.flip(
        getDeviceInfo.pipe(
          Effect.provide(
            bridgeLayer(() => ({
              getPlatform: () => "ios",
              nativePromise: async () =>
                await Effect.runPromise(Effect.fail(cause)),
            }))
          )
        )
      );
      assert.instanceOf(error, BridgeCallFailed);
      if (error._tag === "BridgeCallFailed") {
        assert.strictEqual(error.cause, cause);
        assert.strictEqual(error.method, "getInfo");
      }
    })
  );
  it.effect(
    "decodes in-memory results and rejects malformed native fields",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          getDeviceInfo.pipe(
            Effect.provide(
              bridgeTestLayer("android", () =>
                Effect.succeed({ ...nativeInfo, osVersion: 16 })
              )
            )
          )
        );
        assert.strictEqual(error._tag, "BridgeDecodeError");
        assert.strictEqual(error.plugin, "Device");
        assert.deepStrictEqual(
          yield* getDeviceInfo.pipe(
            Effect.provide(
              bridgeTestLayer("android", () => Effect.succeed(nativeInfo))
            )
          ),
          nativeInfo
        );
      })
  );
});
