import { createRequire } from "node:module";
import path from "node:path";

/** Self-resolution works from source and from any flat packed entry or chunk. */
export const resolvePackageRoot = (moduleUrl: string) =>
  path.dirname(createRequire(moduleUrl).resolve("radical/package.json"));

export const resolveOfflineEntry = (moduleUrl: string) =>
  path.join(
    resolvePackageRoot(moduleUrl),
    moduleUrl.endsWith(".ts")
      ? "src/core/offline/offline-main.ts"
      : "dist/offline-entry.mjs"
  );
