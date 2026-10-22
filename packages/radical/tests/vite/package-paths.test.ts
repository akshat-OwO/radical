import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  resolveOfflineEntry,
  resolvePackageRoot,
} from "../../src/vite/package-paths.ts";

const packageUrl = new URL("../../", import.meta.url);
const packageRoot = fileURLToPath(packageUrl).replace(/\/$/u, "");

describe("package paths", () => {
  it.effect(
    "resolves the package root from source and flat packed modules",
    () =>
      Effect.sync(() => {
        for (const module of [
          "src/native/android/generate.ts",
          "src/native/ios/generate.ts",
          "src/vite/offline-build.ts",
          "dist/cli.mjs",
          "dist/vite.mjs",
          "dist/shared-chunk.mjs",
        ]) {
          assert.strictEqual(
            resolvePackageRoot(new URL(module, packageUrl).href),
            packageRoot
          );
        }
      })
  );

  it.effect(
    "selects the source worker for Vitest and the packed worker for dist",
    () =>
      Effect.sync(() => {
        assert.strictEqual(
          resolveOfflineEntry(
            new URL("src/vite/offline-build.ts", packageUrl).href
          ),
          fileURLToPath(new URL("src/core/offline/offline-main.ts", packageUrl))
        );
        assert.strictEqual(
          resolveOfflineEntry(new URL("dist/vite.mjs", packageUrl).href),
          fileURLToPath(new URL("dist/offline-entry.mjs", packageUrl))
        );
      })
  );
});
