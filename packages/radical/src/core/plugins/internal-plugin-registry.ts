import { Record } from "effect";

import * as manifests from "./internal-plugins.ts";
import type { PluginManifest } from "./plugins.ts";

interface InternalCapability {
  readonly default: boolean;
  readonly plugins: readonly {
    readonly manifest: PluginManifest;
    readonly selector: keyof typeof manifests;
  }[];
  readonly implies: readonly string[];
  /** Relative to radical's package root, not the manifest module. */
  readonly sourceRoot: string;
}

const defineRegistry = <
  const Entries extends Record<string, InternalCapability>,
>(
  entries: Entries & {
    readonly [Key in keyof Entries]: {
      readonly implies: readonly (keyof Entries)[];
    };
  }
) => entries;

// Keep this data browser-safe. Native generation consumes it from build code.
export const internalPluginRegistry = defineRegistry({
  googleSignIn: {
    default: false,
    plugins: [
      {
        manifest: manifests.googleSignInPlugin,
        selector: "googleSignInPlugin",
      },
    ],
    implies: [],
    sourceRoot: ".",
  },
  dataProtection: {
    default: false,
    plugins: [
      {
        manifest: manifests.dataProtectionPlugin,
        selector: "dataProtectionPlugin",
      },
    ],
    implies: [],
    sourceRoot: ".",
  },
  network: {
    default: false,
    plugins: [{ manifest: manifests.networkPlugin, selector: "networkPlugin" }],
    implies: [],
    sourceRoot: ".",
  },
  notifications: {
    default: false,
    plugins: [
      {
        manifest: manifests.localNotificationsPlugin,
        selector: "localNotificationsPlugin",
      },
      { manifest: manifests.badgePlugin, selector: "badgePlugin" },
    ],
    implies: ["network"],
    sourceRoot: ".",
  },
  pushNotifications: {
    default: false,
    plugins: [
      {
        manifest: manifests.firebaseMessagingPlugin,
        selector: "firebaseMessagingPlugin",
      },
      {
        manifest: manifests.notificationTopicsPlugin,
        selector: "notificationTopicsPlugin",
      },
    ],
    implies: ["notifications"],
    sourceRoot: ".",
  },
  videoStream: {
    default: false,
    plugins: [
      { manifest: manifests.videoStreamPlugin, selector: "videoStreamPlugin" },
    ],
    implies: [],
    sourceRoot: ".",
  },
  camera: {
    default: false,
    plugins: [{ manifest: manifests.cameraPlugin, selector: "cameraPlugin" }],
    implies: [],
    sourceRoot: ".",
  },
  filePicker: {
    default: false,
    plugins: [
      { manifest: manifests.filePickerPlugin, selector: "filePickerPlugin" },
    ],
    implies: [],
    sourceRoot: ".",
  },
  haptics: {
    default: false,
    plugins: [{ manifest: manifests.hapticsPlugin, selector: "hapticsPlugin" }],
    implies: [],
    sourceRoot: ".",
  },
  intents: {
    default: false,
    plugins: [
      { manifest: manifests.appLauncherPlugin, selector: "appLauncherPlugin" },
      { manifest: manifests.fileOpenerPlugin, selector: "fileOpenerPlugin" },
    ],
    implies: [],
    sourceRoot: ".",
  },
  device: {
    default: true,
    plugins: [{ manifest: manifests.devicePlugin, selector: "devicePlugin" }],
    implies: [],
    sourceRoot: ".",
  },
  transitions: {
    default: true,
    plugins: [
      { manifest: manifests.transitionsPlugin, selector: "transitionsPlugin" },
    ],
    implies: [],
    sourceRoot: ".",
  },
});

export type InternalPluginFlag = keyof typeof internalPluginRegistry;
export type InternalPluginConfig = Readonly<
  Partial<Record<InternalPluginFlag, boolean>>
>;

export const resolveInternalPlugins = (config: InternalPluginConfig = {}) => {
  const enabled = new Set<InternalPluginFlag>();
  const pending: InternalPluginFlag[] = [];
  const enable = (flag: InternalPluginFlag) => {
    if (!enabled.has(flag)) {
      enabled.add(flag);
      pending.push(flag);
    }
  };
  const flags = Record.keys(internalPluginRegistry);
  for (const flag of flags) {
    if (config[flag] ?? internalPluginRegistry[flag].default) {
      enable(flag);
    }
  }
  for (const current of pending) {
    for (const flag of internalPluginRegistry[current].implies) {
      enable(flag);
    }
  }
  return flags.flatMap((flag) => {
    const capability = internalPluginRegistry[flag];
    return enabled.has(flag)
      ? capability.plugins.map((plugin) => ({
          ...plugin,
          module: "radical/internal-plugins",
          sourceRoot: capability.sourceRoot,
        }))
      : [];
  });
};
