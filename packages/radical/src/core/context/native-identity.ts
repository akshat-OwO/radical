import type { RadicalConfig } from "../../vite/config.ts";

export const nativeIdentity = (
  config: RadicalConfig,
  platform: "android" | "ios"
) => ({
  appId:
    platform === "android"
      ? (config.android?.packageId ?? config.appId)
      : (config.ios?.bundleId ?? config.appId),
  name: config[platform]?.name ?? config.name ?? config.appName ?? config.appId,
});
