import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, FileSystem, Layer } from "effect";
import type * as Vite from "vite";
import type { Plugin } from "vite";

import { RadicalAdapter } from "../core/adapter/adapter.ts";
import { offlineCachePrefix } from "../core/offline/offline-protocol.ts";
import type { RadicalConfig } from "./config.ts";
import { OfflineBuildError } from "./offline-build-error.ts";
import { resolveOfflineEntry } from "./package-paths.ts";

const attempt = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new OfflineBuildError({ cause }),
  });

export class OfflineCompiler extends Context.Service<
  OfflineCompiler,
  {
    readonly compile: (
      config: Vite.InlineConfig
    ) => Effect.Effect<string, OfflineBuildError>;
  }
>()("radical/OfflineCompiler") {}

export const offlineCompilerLayer = Layer.succeed(OfflineCompiler, {
  compile: (config) =>
    Effect.gen(function* () {
      const { build } = yield* Effect.try({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node loads the installed Vite module with its declared types.
        try: () => createRequire(import.meta.url)("vite") as typeof Vite,
        catch: (cause) => new OfflineBuildError({ cause }),
      });
      const result = yield* attempt(() => build(config));
      const outputs = Array.isArray(result) ? result : [result];
      const source = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((item) => item.type === "chunk");
      if (!source || source.type !== "chunk") {
        return yield* new OfflineBuildError({
          cause: "Worker build produced no entry",
        });
      }
      return source.code;
    }),
});

export const offlineBuild = (
  config: RadicalConfig,
  adapterLayer: Layer.Layer<RadicalAdapter>,
  services = Layer.merge(offlineCompilerLayer, NodeFileSystem.layer)
): Plugin => {
  let base = "/";
  let clientDir = "";
  return {
    name: "radical:offline",
    apply: "build",
    configResolved: (resolved) =>
      Effect.runPromise(
        Effect.gen(function* () {
          ({ base } = resolved);
          const adapter = yield* RadicalAdapter;
          const outputs = yield* adapter.outputs;
          clientDir = path.resolve(resolved.root, outputs.clientDir);
        }).pipe(Effect.provide(adapterLayer))
      ),
    writeBundle: {
      order: "post",
      handler(_output, bundle) {
        if (
          path.resolve(
            this.environment.config.root,
            this.environment.config.build.outDir
          ) !== clientDir
        ) {
          return Promise.resolve();
        }
        return Effect.runPromise(
          Effect.gen(function* () {
            const compiler = yield* OfflineCompiler;
            const fs = yield* FileSystem.FileSystem;
            const entries = Object.values(bundle).toSorted((a, b) =>
              a.fileName.localeCompare(b.fileName)
            );
            const manifest = {
              buildId: "RADICAL_BUILD_CONTENT_HASH",
              cachePrefix: offlineCachePrefix(config.appId, base),
              assets: entries.map((item) => `${base}${item.fileName}`),
              fallback: `${base}offline.html`,
            };
            const source = yield* compiler.compile({
              configFile: false,
              publicDir: false,
              define: { __RADICAL_MANIFEST__: JSON.stringify(manifest) },
              build: {
                write: false,
                minify: true,
                lib: {
                  entry: resolveOfflineEntry(import.meta.url),
                  formats: ["iife"],
                  name: "RadicalOfflineWorker",
                },
              },
            });
            const hash = createHash("sha256").update(source);
            for (const entry of entries) {
              hash
                .update(entry.fileName)
                .update(entry.type === "chunk" ? entry.code : entry.source);
            }
            hash.update(
              yield* fs.readFile(path.resolve(clientDir, "offline.html"))
            );
            manifest.buildId = hash.digest("hex");
            yield* fs.writeFileString(
              path.resolve(clientDir, "radical-manifest.json"),
              JSON.stringify(manifest)
            );
            return yield* fs.writeFileString(
              path.resolve(clientDir, "radical-sw.js"),
              source.replaceAll("RADICAL_BUILD_CONTENT_HASH", manifest.buildId)
            );
          }).pipe(Effect.provide(services))
        );
      },
    },
  };
};
