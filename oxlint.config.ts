import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
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
