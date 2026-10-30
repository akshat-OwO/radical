import { Schema } from "effect";

import type { RadicalConfig } from "../../vite/config.ts";
import type { NativeContext } from "../context/native-context.ts";
import { nativeIdentity } from "../context/native-identity.ts";

export const MinimumBuildSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);

export const AppUpdatePolicySchema = Schema.Struct({
  android: Schema.optional(MinimumBuildSchema),
  ios: Schema.optional(MinimumBuildSchema),
});

export type AppUpdatePolicy = typeof AppUpdatePolicySchema.Type;

export const AppUpdateStateSchema = Schema.Struct({
  status: Schema.Literals(["current", "required", "unknown"]),
  storeUrl: Schema.NullOr(
    Schema.String.check(
      Schema.isPattern(
        /^https:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9_.]+|apps\.apple\.com\/app\/id[0-9]+)$/u
      )
    )
  ),
});

export type AppUpdateState = typeof AppUpdateStateSchema.Type;

export const unknownAppUpdate: AppUpdateState = {
  status: "unknown",
  storeUrl: null,
};

export const APP_UPDATE_PATH = "/__radical/update-policy";
export const APP_UPDATE_HEADER = "x-radical-update";

/** Store identities come from the same config as shell generation. */
export const appStoreUrl = (
  config: RadicalConfig,
  platform: NativeContext["platform"]
): string | null => {
  if (platform === "android") {
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(nativeIdentity(config, platform).appId)}`;
  }

  return platform === "ios" && config.ios?.appStoreId !== undefined
    ? `https://apps.apple.com/app/id${encodeURIComponent(config.ios.appStoreId)}`
    : null;
};

export const resolveAppUpdate = (
  context: NativeContext,
  policy: AppUpdatePolicy,
  config: RadicalConfig
): AppUpdateState => {
  if (context.platform === "browser") {
    return { status: "current", storeUrl: null };
  }

  const minimum = policy[context.platform];

  return {
    status:
      minimum !== undefined &&
      (context.appBuild === undefined || context.appBuild < minimum)
        ? "required"
        : "current",
    storeUrl: appStoreUrl(config, context.platform),
  };
};

/** One controller per client application; server rendering never mutates it. */
export const createAppUpdateStore = (
  initialState: AppUpdateState = unknownAppUpdate
) => {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: AppUpdateState) => {
      // A late startup response cannot dismiss a rejection from another request.
      if (state.status === "required" && next.status !== "required") {
        return;
      }

      state = next;

      for (const listener of listeners) {
        listener();
      }
    },
  };
};

export type AppUpdateStore = ReturnType<typeof createAppUpdateStore>;

export const appUpdateStore = createAppUpdateStore();
