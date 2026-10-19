import { defineConfig } from "vite-plus";

import fmt from "./oxfmt.config.ts";
import lint from "./oxlint.config.ts";

export default defineConfig({
  staged: {
    "*": "ultracite fix",
  },
  fmt,
  lint: {
    ...lint,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    options: { typeAware: true, typeCheck: true },
    rules: { ...lint.rules, "vite-plus/prefer-vite-plus-imports": "error" },
    overrides: [
      ...(lint.overrides ?? []),
      {
        // Published types must name `vite`, the peer consumers install.
        files: ["packages/radical/src/**/*.ts"],
        rules: { "vite-plus/prefer-vite-plus-imports": "off" },
      },
    ],
  },
  run: {
    cache: true,
  },
});
