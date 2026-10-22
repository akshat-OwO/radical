import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      vite: "src/build/vite.ts",
      plugins: "src/core/plugins/plugins.ts",
      "internal-plugins": "src/core/plugins/internal-plugins.ts",
      cli: "src/entry/cli.ts",
      "tanstack-start": "src/adapters/tanstack-start/tanstack-start.ts",
      "tanstack-start-client":
        "src/adapters/tanstack-start/tanstack-start-client.ts",
      server: "src/entry/server.ts",
      client: "src/entry/client.ts",
      react: "src/react/react.ts",
      "offline-entry": "src/core/offline/offline-entry.ts",
      "tanstack-start-server":
        "src/adapters/tanstack-start/tanstack-start-server.ts",
      "native-context": "src/core/context/native-context.ts",
    },
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    exports: false,
    copy: ["src/capabilities/transitions/transitions.css"],
  },
});
