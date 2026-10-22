import type { Effect } from "effect";

import type { BuildPlan } from "./build-plan.ts";
import type { InvalidConfig } from "./config.ts";
import type {
  InvalidPlugin,
  PluginDependencyConflict,
} from "./plugins/errors.ts";

/** Vite and the CLI share the resolved plan without serializing decoded schema values. */
export class BuildPlanApi {
  readonly resolve: (
    root: string
  ) => Effect.Effect<
    BuildPlan,
    InvalidConfig | InvalidPlugin | PluginDependencyConflict
  >;

  constructor(resolve: BuildPlanApi["resolve"]) {
    this.resolve = resolve;
  }
}
