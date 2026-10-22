import { Effect } from "effect";

import { resolveBuildPlan, renderPlist } from "../../src/vite/build-plan.ts";
import type { RadicalConfig } from "../../src/vite/config.ts";
import { PluginModules } from "../../src/vite/plugins/plugin-plan.ts";

export const cameraDeclarations = (config: RadicalConfig) =>
  resolveBuildPlan({
    ...config,
    plugins: [],
    internalPlugins: {
      device: false,
      transitions: false,
      camera: config.internalPlugins?.camera,
      videoStream: config.internalPlugins?.videoStream,
    },
    pluginOptions: config.pluginOptions,
  }).pipe(
    Effect.provideService(PluginModules, {
      load: () => Effect.die("No custom plugins"),
    }),
    Effect.map((plan) => ({
      android: plan.android.declarations.join(""),
      ios: renderPlist(plan.ios.plist),
    }))
  );
