import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // Generated files: Pullfrog asks not to edit its workflow, and TanStack
  // Router rewrites the route tree on every dev and build.
  ignorePatterns: [".github/workflows/pullfrog.yml", "**/routeTree.gen.ts"],
});
