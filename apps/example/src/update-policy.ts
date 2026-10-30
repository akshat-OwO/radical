import type { AppUpdateOptions } from "@akshatowo/radical/server";
import { config } from "virtual:radical/config";

// Server-only policy. Raise these only after the replacement is live in its store.
export const readUpdatePolicy = (): AppUpdateOptions => ({
  config,
  updatePath: "/update",
  minimumBuild: {
    android: Number(process.env.RADICAL_MIN_ANDROID_BUILD ?? 1),
    ios: Number(process.env.RADICAL_MIN_IOS_BUILD ?? 1),
  },
});
