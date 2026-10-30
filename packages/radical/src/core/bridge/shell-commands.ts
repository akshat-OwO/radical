import { Schema } from "effect";

export const ShellCommandsSchema = Schema.Record(
  Schema.String,
  Schema.Array(Schema.String)
);

export type ShellCommands = typeof ShellCommandsSchema.Type;

interface ShellWindow extends Window {
  readonly __radicalShellCommands?: ShellCommands;
}

/** Kept separate from native context: this payload never travels to the server. */
export const injectedShellCommands = (): ShellCommands | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const shell: ShellWindow = window;

  return shell.__radicalShellCommands;
};

/** Capacitor implements listener management on every registered plugin. */
export const hasShellCommand = (
  commands: ShellCommands | undefined,
  plugin: string,
  method: string
): boolean =>
  commands === undefined ||
  (Object.hasOwn(commands, plugin) &&
    (commands[plugin]?.includes(method) ||
      method === "addListener" ||
      method === "removeListener" ||
      method === "removeAllListeners"));
