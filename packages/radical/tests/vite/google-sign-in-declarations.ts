import { Effect } from "effect";

import { resolveBuildPlan, renderPlist } from "../../src/vite/build-plan.ts";
import type { RadicalConfig } from "../../src/vite/config.ts";
import { PluginModules } from "../../src/vite/plugins/plugin-plan.ts";

export const googleSignInDeclarations = (config: RadicalConfig) =>
  resolveBuildPlan({
    ...config,
    plugins: [],
    internalPlugins: {
      device: false,
      transitions: false,
      googleSignIn: config.internalPlugins?.googleSignIn,
    },
  }).pipe(
    Effect.provideService(PluginModules, {
      load: () => Effect.die("No custom plugins"),
    }),
    Effect.map((plan) => renderPlist(plan.ios.plist))
  );
