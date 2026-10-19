import os from "node:os";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import type { ViteDevServer } from "vite";

import type { RadicalConfig } from "./config.ts";

export const configureServer = (
  config: RadicalConfig,
  server: ViteDevServer
) => {
  server.httpServer?.once("listening", () => {
    const address = server.httpServer?.address();
    if (
      address === null ||
      address === undefined ||
      typeof address === "string"
    ) {
      return;
    }
    const host =
      config.devHost ??
      Object.values(os.networkInterfaces())
        .flat()
        .find((entry) => entry?.family === "IPv4" && !entry.internal)
        ?.address ??
      "127.0.0.1";
    Effect.runFork(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = path.join(server.config.root, ".radical");
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(
          path.join(directory, "native.json"),
          JSON.stringify({ config, url: `http://${host}:${address.port}` })
        );
      }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.tapError((error) =>
          Effect.sync(() => {
            server.config.logger.error(String(error));
          })
        ),
        Effect.ignore
      )
    );
  });
};
