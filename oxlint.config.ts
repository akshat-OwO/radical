import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import next from "ultracite/oxlint/next";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

import {
  capacitorAllowedFiles,
  capacitorScopes,
} from "./packages/radical/tests/capacitor-boundary-policy.ts";

export default defineConfig({
  env: core.env,
  extends: [core, react, tanstack, vitest, antiSlop],
  ignorePatterns: [...(core.ignorePatterns ?? []), "**/dist/**", ".radical/**"],
  options: { typeAware: true },
  overrides: [
    { files: ["apps/docs/**/*.{ts,tsx,js,mjs}"], ...next },
    {
      // This wire decoder validates arbitrary worker messages without bundling Effect into native scripts.
      files: ["packages/radical/src/core/offline/offline-wire.ts"],
      rules: { "anti-slop/no-unknown-parameters": "off" },
    },
    {
      // The transport carries arbitrary plugin payloads; each capability decodes its own codec.
      files: ["packages/radical/src/core/bridge/bridge.ts"],
      rules: {
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
      },
    },
    {
      // Module exports remain opaque until the selected manifest is decoded by PluginManifestSchema.
      files: ["packages/radical/src/vite/plugins/plugin-modules.ts"],
      rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
    },
    {
      // Only the plugin manifest and shell generators may depend on Capacitor.
      // Keep this exact allowlist in sync with ADR 0003; tests need no exception.
      files: capacitorAllowedFiles,
      rules: { "no-restricted-imports": "off" },
    },
    {
      files: ["packages/radical/src/**/*.ts"],
      // Effect factories and the Vite Promise boundary do not use async functions.
      rules: {
        "oxc/no-async-await": "error",
        "promise/prefer-await-to-callbacks": "off",
        "typescript/promise-function-async": "off",
        "unicorn/throw-new-error": "off",
      },
    },
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            // Whole scopes cover official and third-party plugins, plus subpaths.
            regex: capacitorScopes,
            allowTypeImports: false,
            message:
              "Keep Capacitor dependencies inside internal-plugins.ts, native-project.ts, or native-assets.ts. Use Radical's bridge and plugin manifests elsewhere.",
          },
        ],
      },
    ],
    // Effect.gen takes anonymous generator functions.
    "func-names": ["error", "always", { generators: "never" }],
    "vitest/no-standalone-expect": [
      "error",
      {
        additionalTestBlockFunctions: [
          "it.effect",
          "it.live",
          "it.scoped",
          "it.layer",
          "it.prop",
        ],
      },
    ],
  },
});
