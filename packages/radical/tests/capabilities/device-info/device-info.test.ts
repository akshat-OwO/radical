import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  browserDeviceInfo,
  DeviceInfoSchema,
} from "../../../src/entry/client.ts";

describe("browser device info", () => {
  it.effect(
    "prefers userAgentData and does not claim a frozen UA version",
    () =>
      Effect.gen(function* () {
        const info = browserDeviceInfo({
          userAgent: "Windows NT 10.0",
          userAgentData: { platform: "macOS", mobile: false },
        });
        assert.strictEqual(info.operatingSystem, "mac");
        assert.strictEqual(info.osVersion, "unknown");
        assert.strictEqual(info.platform, "web");
        assert.strictEqual(info.model, "unknown");
        assert.deepStrictEqual(
          yield* Schema.decodeEffect(DeviceInfoSchema)(info),
          info
        );
      })
  );
  it.effect(
    "parses common OS versions conservatively without client hints",
    () =>
      Effect.sync(() => {
        const cases = [
          ["Mozilla/5.0 (Linux; Android 16; Pixel 9)", "android", "16"],
          [
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)",
            "ios",
            "18.2",
          ],
          ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7)", "mac", "14.7"],
          ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "windows", "10.0"],
          ["Mozilla/5.0 (X11; Linux x86_64)", "linux", "unknown"],
          ["unrecognized", "unknown", "unknown"],
        ];
        for (const [userAgent, operatingSystem, osVersion] of cases) {
          const info = browserDeviceInfo({ userAgent });
          assert.strictEqual(info.operatingSystem, operatingSystem);
          assert.strictEqual(info.osVersion, osVersion);
          assert.strictEqual(info.platform, "web");
        }
      })
  );
});
