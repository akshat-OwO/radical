import type { ShellCommands } from "../../core/bridge/shell-commands.ts";
import type { BuildPlan } from "../../vite/build-plan.ts";

/** Dependency-only manifests use Capacitor's plugins on both platforms. */
export const shellCommands = (
  plan: Pick<BuildPlan, "plugins" | "navigation">,
  platform: "android" | "ios"
): ShellCommands => {
  const commands: Record<string, readonly string[]> = Object.fromEntries(
    plan.plugins
      .filter(
        ({ manifest }) =>
          manifest[platform] !== undefined ||
          (manifest.android === undefined && manifest.ios === undefined)
      )
      .map(({ manifest }) => [
        manifest.bridge,
        Object.keys(manifest.commands).toSorted(),
      ])
  );

  if (plan.navigation && plan.navigation.bar?.[platform] !== "web") {
    commands.RadicalNavigation = ["update"];
  }

  return commands;
};

export const shellCommandsScript = (
  plan: Pick<BuildPlan, "plugins" | "navigation">,
  platform: "android" | "ios"
) =>
  `window.__radicalShellCommands=${JSON.stringify(shellCommands(plan, platform))};`;
