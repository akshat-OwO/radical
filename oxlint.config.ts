import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  env: core.env,
  extends: [core, react, tanstack, vitest],
  ignorePatterns: [...(core.ignorePatterns ?? []), "**/dist/**", ".radical/**"],
  options: { typeAware: true },
  overrides: [
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
