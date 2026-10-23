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
    tasks: {
      ready: {
        // Always remove dist and execute the source checks before building.
        cache: false,
        command:
          "node packages/radical/scripts/clean-dist.ts && vp run --no-cache @radical/example#typegen:source && vp run --no-cache @radical/docs#typecheck && ultracite check && vp run --no-cache @radical/example#typecheck && vp run @akshatowo/radical#build && vp run @radical/example#typegen && vp run @radical/docs#build && vp check && vp run -r typecheck && vp run -r test",
      },
    },
  },
});
