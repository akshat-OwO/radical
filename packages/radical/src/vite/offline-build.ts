import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import type * as Vite from "vite";
import type { Plugin } from "vite";

import { RadicalAdapter } from "../core/adapter/adapter.ts";
import { offlineCachePrefix } from "../core/offline/offline-protocol.ts";
import type { RadicalConfig } from "./config.ts";
import { resolveOfflineEntry } from "./package-paths.ts";

class OfflineBuildError extends Schema.TaggedError<
  OfflineBuildError,
  { readonly brand: unique symbol }
>()("OfflineBuildError", { cause: Schema.Unknown }) {}

const attempt = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new OfflineBuildError({ cause }),
  });

export const offlineBuild = (
  config: RadicalConfig,
  adapterLayer: Layer.Layer<RadicalAdapter>
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
            // Load Vite only in the Node build hook. Runtime middleware shares
            // this entry, so a static import would pull Vite into client builds.
            const { build } = yield* Effect.try({
              try: () =>
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node loads the installed Vite module with its declared types.
                createRequire(import.meta.url)("vite") as typeof Vite,
              catch: (cause) => new OfflineBuildError({ cause }),
            });
            const entries = Object.values(bundle).toSorted((a, b) =>
              a.fileName.localeCompare(b.fileName)
            );
            const manifest = {
              buildId: "RADICAL_BUILD_CONTENT_HASH",
              cachePrefix: offlineCachePrefix(config.appId, base),
              assets: entries.map((item) => `${base}${item.fileName}`),
              fallback: `${base}offline.html`,
            };
            const result = yield* attempt(() =>
              build({
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
              })
            );
            const outputs = Array.isArray(result) ? result : [result];
            const source = outputs
              .flatMap((output) => ("output" in output ? output.output : []))
              .find((item) => item.type === "chunk");
            if (!source || source.type !== "chunk") {
              return yield* new OfflineBuildError({
                cause: "Worker build produced no entry",
              });
            }
            const hash = createHash("sha256").update(source.code);
            for (const entry of entries) {
              hash
                .update(entry.fileName)
                .update(entry.type === "chunk" ? entry.code : entry.source);
            }
            hash.update(
              yield* attempt(() =>
                readFile(path.resolve(clientDir, "offline.html"))
              )
            );
            manifest.buildId = hash.digest("hex");
            yield* attempt(() =>
              writeFile(
                path.resolve(clientDir, "radical-manifest.json"),
                JSON.stringify(manifest)
              )
            );
            return yield* attempt(() =>
              writeFile(
                path.resolve(clientDir, "radical-sw.js"),
                source.code.replaceAll(
                  "RADICAL_BUILD_CONTENT_HASH",
                  manifest.buildId
                )
              )
            );
          })
        );
      },
    },
  };
};
