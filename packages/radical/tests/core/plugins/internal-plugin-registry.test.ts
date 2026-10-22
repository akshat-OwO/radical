import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Record, Schema } from "effect";
import * as publicManifests from "radical/internal-plugins";

import {
  internalPluginRegistry,
  resolveInternalPlugins,
} from "../../../src/core/plugins/internal-plugin-registry.ts";
import type {
  InternalPluginConfig,
  InternalPluginFlag,
} from "../../../src/core/plugins/internal-plugin-registry.ts";
import { RadicalConfigSchema } from "../../../src/vite/config.ts";
import {
  PluginModules,
  resolvePlugins,
} from "../../../src/vite/plugins/plugin-plan.ts";

// Freeze the old policy independently of the registry, including output order.
const legacyPlugins = (config: InternalPluginConfig) => {
  const notifications =
    config.notifications === true || config.pushNotifications === true;
  return (
    [
      [config.googleSignIn === true, "googleSignIn"],
      [config.dataProtection === true, "dataProtection"],
      [config.network === true || notifications, "network"],
      [notifications, "localNotifications"],
      [notifications, "badge"],
      [config.pushNotifications === true, "firebaseMessaging"],
      [config.pushNotifications === true, "notificationTopics"],
      [config.videoStream === true, "videoStream"],
      [config.camera === true, "camera"],
      [config.filePicker === true, "filePicker"],
      [config.haptics === true, "haptics"],
      [config.intents === true, "appLauncher"],
      [config.intents === true, "fileOpener"],
      [config.device !== false, "device"],
      [config.transitions !== false, "transitions"],
    ] as const
  ).flatMap(([enabled, id]) => (enabled ? [id] : []));
};
const flags = [
  "googleSignIn",
  "dataProtection",
  "network",
  "notifications",
  "pushNotifications",
  "videoStream",
  "camera",
  "filePicker",
  "haptics",
  "intents",
  "device",
  "transitions",
] as const satisfies readonly InternalPluginFlag[];
const combination = (
  index: number,
  states: readonly (boolean | undefined)[]
) => {
  const config: Partial<Record<InternalPluginFlag, boolean>> = {};
  let remaining = index;
  for (const flag of flags) {
    const value = states[remaining % states.length];
    if (value !== undefined) {
      config[flag] = value;
    }
    remaining = Math.floor(remaining / states.length);
  }
  return config;
};
const pluginOptions = {
  Camera: {
    usageDescription: "Take a photo",
    photoLibraryUsageDescription: "Choose a photo",
  },
  VideoStream: { usageDescription: "Scan a code" },
  GoogleSignIn: {
    webClientId: "web.apps.googleusercontent.com",
    iosClientId: "ios.apps.googleusercontent.com",
  },
};

describe("internal plugin registry", () => {
  it.effect("accepts every registry flag in the config schema", () =>
    Effect.gen(function* () {
      const internalPlugins = combination(2 ** flags.length - 1, [false, true]);
      const config = yield* Schema.decodeUnknownEffect(RadicalConfigSchema, {
        onExcessProperty: "error",
      })({ appId: "dev.test.app", internalPlugins });
      assert.deepStrictEqual(config.internalPlugins, internalPlugins);
    })
  );
  it.effect(
    "matches the previous ordered plugin set for all 531441 omitted/false/true flag combinations",
    () =>
      Effect.sync(() => {
        assert.deepStrictEqual(Record.keys(internalPluginRegistry), [...flags]);
        for (let index = 0; index < 3 ** flags.length; index += 1) {
          const config = combination(index, [undefined, false, true]);
          const plugins = resolveInternalPlugins(config);
          assert.deepStrictEqual(
            plugins.map(({ manifest }) => manifest.id),
            legacyPlugins(config)
          );
        }
      })
  );
  it.effect(
    "validates the same ordered plugin set through resolvePlugins for all 4096 boolean combinations",
    () =>
      Effect.gen(function* () {
        const modules = Layer.succeed(PluginModules, {
          load: () =>
            Effect.die("Internal resolution must not load custom modules"),
        });
        for (let index = 0; index < 2 ** flags.length; index += 1) {
          const internalPlugins = combination(index, [false, true]);
          const plugins = yield* resolvePlugins({
            appId: "dev.test.app",
            internalPlugins,
            pluginOptions,
          }).pipe(Effect.provide(modules));
          assert.deepStrictEqual(
            plugins.map(({ manifest }) => manifest.id),
            legacyPlugins(internalPlugins)
          );
        }
      })
  );
  it.effect(
    "names actual radical/internal-plugins exports with matching manifests",
    () =>
      Effect.sync(() => {
        for (const capability of Object.values(internalPluginRegistry)) {
          for (const { manifest, selector } of capability.plugins) {
            assert.isTrue(Object.hasOwn(publicManifests, selector), selector);
            const exported = Object.entries(publicManifests).find(
              ([name]) => name === selector
            );
            assert.strictEqual(exported?.[1].id, manifest.id);
          }
        }
      })
  );
});
