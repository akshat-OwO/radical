import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      vite: "src/plain/vite.ts",
      plugins: "src/plain/plugins.ts",
      "internal-plugins": "src/core/plugins/internal-plugins.ts",
      cli: "src/entry/cli-main.ts",
      "tanstack-start": "src/plain/tanstack-start.ts",
      "tanstack-start-client": "src/plain/tanstack-start-client.ts",
      server: "src/plain/server.ts",
      client: "src/plain/client.ts",
      react: "src/plain/react.ts",
      "offline-entry": "src/core/offline/offline-main.ts",
      "tanstack-start-server": "src/plain/tanstack-start-server.ts",
      "native-context": "src/plain/native-context.ts",
      "effect/client": "src/effect/client.ts",
      "effect/plugins": "src/core/plugins/plugins.ts",
      "effect/server": "src/entry/server.ts",
      "effect/native-context": "src/core/context/native-context.ts",
      "effect/react": "src/effect/react.ts",
      "effect/vite": "src/vite/vite.ts",
      "effect/tanstack-start": "src/adapters/tanstack-start/tanstack-start.ts",
      "effect/tanstack-start-client":
        "src/adapters/tanstack-start/tanstack-start-client.ts",
      "effect/tanstack-start-server":
        "src/adapters/tanstack-start/tanstack-start-server.ts",
    },
    deps: {
      neverBundle: [/^effect(?:\/|$)/u],
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
