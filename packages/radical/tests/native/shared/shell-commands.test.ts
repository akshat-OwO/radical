import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { locationPlugin } from "../../../src/capabilities/location/location-plugin.ts";
import { devicePlugin } from "../../../src/core/plugins/internal-plugins.ts";
import {
  shellCommands,
  shellCommandsScript,
} from "../../../src/native/shared/shell-commands.ts";
import { echo } from "../../fixtures/echo-plugin.ts";

it.effect(
  "filters platform-only plugins and retains dependency plugins on both platforms",
  () =>
    Effect.sync(() => {
      const { ios, android, ...shared } = echo;

      const plan = {
        plugins: [
          {
            manifest: { ...shared, bridge: "AndroidOnly", android },
            module: "android",
            selector: "default",
          },
          {
            manifest: { ...shared, bridge: "IosOnly", ios },
            module: "ios",
            selector: "default",
          },
          { manifest: devicePlugin, module: "device", selector: "default" },
        ],
        navigation: undefined,
      };

      assert.deepStrictEqual(shellCommands(plan, "android"), {
        AndroidOnly: ["echo"],
        Device: ["getInfo"],
      });
      assert.deepStrictEqual(shellCommands(plan, "ios"), {
        IosOnly: ["echo"],
        Device: ["getInfo"],
      });
      assert.strictEqual(
        shellCommandsScript(plan, "ios"),
        'window.__radicalShellCommands={"IosOnly":["echo"],"Device":["getInfo"]};'
      );
    })
);

it.effect(
  "includes native navigation only on platforms with a native bar",
  () =>
    Effect.sync(() => {
      const plan = {
        plugins: [],
        navigation: {
          sections: [],
          bar: { android: "web" as const, ios: "native" as const },
        },
      };

      assert.deepStrictEqual(shellCommands(plan, "android"), {});
      assert.deepStrictEqual(shellCommands(plan, "ios"), {
        RadicalNavigation: ["update"],
      });
    })
);

it.effect(
  "reports location subscription acquisition and release commands",
  () =>
    Effect.sync(() => {
      const plan = {
        plugins: [
          { manifest: locationPlugin, module: "location", selector: "default" },
        ],
        navigation: undefined,
      };

      for (const platform of ["android", "ios"] as const) {
        assert.deepStrictEqual(shellCommands(plan, platform).Geolocation, [
          "checkPermissions",
          "clearWatch",
          "getCurrentPosition",
          "requestPermissions",
          "watchPosition",
        ]);
      }
    })
);
