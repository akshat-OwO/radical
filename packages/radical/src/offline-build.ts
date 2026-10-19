import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Schema } from "effect";
import type { Plugin } from "vite";

import type { RadicalConfig } from "./config.ts";
import { renderServiceWorker } from "./offline-worker.ts";

class OfflineBuildError extends Schema.TaggedError<
  OfflineBuildError,
  { readonly brand: unique symbol }
>()("OfflineBuildError", { cause: Schema.Unknown }) {}

const attempt = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new OfflineBuildError({ cause }),
  });

/** The adapter supplies a server-only module that exports plain route records. */
export const offlineBuild = (
  config: RadicalConfig,
  routesModule: (root: string) => string
): Plugin => {
  const virtualId = "\0radical:routes";
  const buildId = randomUUID();
  let root = "";
  let base = "/";
  let clientDir = "";
  let assets: string[] = [];
  return {
    name: "radical:offline",
    apply: "build",
    configResolved: (resolved) => {
      ({ root, base } = resolved);
      clientDir = path.resolve(
        root,
        resolved.environments.client?.build.outDir ?? "dist/client"
      );
    },
    resolveId: (id) => (id === virtualId ? virtualId : undefined),
    load: (id) => (id === virtualId ? routesModule(root) : undefined),
    buildStart() {
      if (this.environment.name === "ssr") {
        this.emitFile({ type: "chunk", id: virtualId, name: "radical-routes" });
      }
    },
    writeBundle: {
      order: "post",
      handler(output, bundle) {
        if (this.environment.name === "client") {
          assets = Object.values(bundle).map(
            (item) => `${base}${item.fileName}`
          );
          return Promise.resolve();
        }
        const entry = Object.values(bundle).find(
          (item) => item.type === "chunk" && item.facadeModuleId === virtualId
        );
        if (!entry) {
          return Promise.resolve();
        }
        return Effect.runPromise(
          Effect.gen(function* () {
            const module: unknown = yield* attempt(
              () =>
                import(
                  pathToFileURL(
                    path.resolve(
                      root,
                      output.dir ?? "dist/server",
                      entry.fileName
                    )
                  ).href
                )
            );
            const { routes } = yield* Schema.decodeUnknownEffect(
              Schema.Struct({
                routes: Schema.Array(
                  Schema.Struct({
                    pattern: Schema.String,
                    offline: Schema.Boolean,
                  })
                ),
              })
            )(module);
            const manifest = {
              buildId,
              cachePrefix: `radical:${config.appId}:${base}:`,
              offlineRoutes: routes
                .filter((route) => route.offline)
                .map((route) => `${base.replace(/\/$/u, "")}${route.pattern}`),
              assets,
              fallback: `${base}offline.html`,
            };
            yield* attempt(() =>
              writeFile(
                path.resolve(clientDir, "radical-manifest.json"),
                JSON.stringify(manifest)
              )
            );
            yield* attempt(() =>
              writeFile(
                path.resolve(clientDir, "radical-sw.js"),
                renderServiceWorker(manifest)
              )
            );
          })
        );
      },
    },
  };
};
