import os from "node:os";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import type { ViteDevServer } from "vite";

import type { RadicalConfig } from "./config.ts";

/** The URL a shell loads; HTTPS dev servers keep their scheme. */
export const devServerUrl = (options: {
  readonly https: boolean;
  readonly host: string;
  readonly port: number;
}) => `${options.https ? "https" : "http"}://${options.host}:${options.port}`;

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
          JSON.stringify({
            config,
            url: devServerUrl({
              https: Boolean(server.config.server.https),
              host,
              port: address.port,
            }),
          })
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
