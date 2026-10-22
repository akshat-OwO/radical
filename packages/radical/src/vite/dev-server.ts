import os from "node:os";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer, Predicate } from "effect";
import type { ViteDevServer } from "vite";

import {
  NativeMetadata,
  nativeMetadataLayer,
} from "../native/shared/native-metadata.ts";
import type { RadicalConfig } from "./config.ts";

/** The origin a shell loads; HTTPS dev servers keep their scheme. */
export const devServerUrl = (options: {
  readonly https: boolean;
  readonly host: string;
  readonly port: number;
}) =>
  new URL(
    `${options.https ? "https" : "http"}://${options.host}:${options.port}`
  ).origin;

export const configureServer = (
  config: RadicalConfig,
  server: Pick<ViteDevServer, "httpServer"> & {
    readonly config: Pick<ViteDevServer["config"], "root"> & {
      readonly server: Pick<ViteDevServer["config"]["server"], "https">;
      readonly logger: Pick<ViteDevServer["config"]["logger"], "error">;
    };
  },
  metadataLayer: Layer.Layer<NativeMetadata> = nativeMetadataLayer.pipe(
    Layer.provide(NodeFileSystem.layer)
  )
) => {
  server.httpServer?.once("listening", () => {
    const address = server.httpServer?.address();
    if (
      address === null ||
      address === undefined ||
      Predicate.isString(address)
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
        const metadata = yield* NativeMetadata;
        yield* metadata.update(
          server.config.root,
          config,
          devServerUrl({
            https: Boolean(server.config.server.https),
            host,
            port: address.port,
          })
        );
      }).pipe(
        Effect.provide(metadataLayer),
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
