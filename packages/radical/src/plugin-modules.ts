import type { Effect } from "effect";
import { Context } from "effect";

import type { InvalidPlugin } from "./invalid-plugin.ts";

export class PluginModules extends Context.Service<
  PluginModules,
  {
    readonly load: (
      module: string
    ) => Effect.Effect<Record<string, unknown>, InvalidPlugin>;
  }
>()("radical/PluginModules") {}
