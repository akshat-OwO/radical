import { callPlugin as callEffectPlugin } from "../core/plugins/plugins.ts";
import type { CommandSchema, PluginManifest } from "../core/plugins/plugins.ts";
import { defaultRuntime, getEffectRuntime } from "./runtime.ts";
import type { RadicalRuntime } from "./runtime.ts";

// Plugin authoring retains Effect Schema codecs in 0.2.

export {
  definePlugin,
  PluginManifestSchema,
  CommandSchema,
} from "../core/plugins/plugins.ts";

export type { PluginManifest } from "../core/plugins/plugins.ts";

type Command = typeof CommandSchema.Type;

export type PluginClient<M extends PluginManifest> = {
  readonly [K in keyof M["commands"]]: (
    args: M["commands"][K]["args"]["Type"]
  ) => Promise<M["commands"][K]["result"]["Type"]>;
};

export const callPlugin = <C extends Command>(
  plugin: string,
  method: string,
  command: C,
  args: C["args"]["Type"],
  runtime: RadicalRuntime = defaultRuntime
): Promise<C["result"]["Type"]> =>
  getEffectRuntime(runtime).runPromise(
    callEffectPlugin(plugin, method, command, args)
  );

// SAFETY: Each manifest key retains its argument and result codecs.
// oxlint-disable typescript/no-unsafe-type-assertion -- Object entries retain the manifest's command keys.

export const createPluginClient = <M extends PluginManifest>(
  manifest: M,
  runtime: RadicalRuntime = defaultRuntime
): PluginClient<M> =>
  Object.fromEntries(
    Object.entries(manifest.commands).map(([name, command]) => [
      name,
      (args: typeof command.args.Type) =>
        callPlugin(manifest.bridge, name, command, args, runtime),
    ])
  ) as PluginClient<M>;
