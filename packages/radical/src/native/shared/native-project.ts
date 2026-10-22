import { createRequire } from "node:module";
import path from "node:path";

import { Effect, FileSystem, Schema } from "effect";
import semver from "semver";

import { encodeNativeContextCookie } from "../../core/context/native-context.ts";
import {
  InvalidConfig,
  nativeIdentity,
  AndroidPackageIdSchema,
  IosBundleIdSchema,
} from "../../vite/config.ts";
import {
  resolvePlugins,
  InvalidPlugin,
} from "../../vite/plugins/plugin-plan.ts";
import type { EnabledPlugin } from "../../vite/plugins/plugin-plan.ts";
import {
  AssetGenerator,
  prepareNativeAssets,
} from "../assets/native-assets.ts";
import { NativeMetadata, nativeMetadataLayer } from "./native-metadata.ts";
import { replaceAnchor } from "./native-template.ts";
import { execute, replaceProject } from "./shell.ts";

const require = createRequire(import.meta.url);
export class NativeToolchainUnavailable extends Schema.TaggedError<
  NativeToolchainUnavailable,
  { readonly brand: unique symbol }
>()("NativeToolchainUnavailable", { message: Schema.String }) {}
/** Cookies share identity across schemes and ports. Plan once per hostname. */
export const nativeCookiePlan = (origins: readonly string[]) => {
  const hosts = new Map<
    string,
    { hostname: string; origin: string; secure: boolean }
  >();
  for (const origin of [...origins].toSorted()) {
    const url = new URL(origin);
    const previous = hosts.get(url.hostname);
    if (!previous || url.protocol === "http:") {
      hosts.set(url.hostname, {
        hostname: url.hostname,
        origin,
        secure: url.protocol === "https:",
      });
    }
  }
  return [...hosts.values()].toSorted((a, b) =>
    a.hostname.localeCompare(b.hostname)
  );
};

export const capacitor = (
  platform: "android" | "ios",
  plugins: readonly EnabledPlugin[],
  root: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const appRequire = createRequire(path.join(root, "package.json"));
    const resolved = yield* Effect.try({
      try: () => ({
        cli: require.resolve("@capacitor/cli/bin/capacitor"),
        packages: [
          ...new Set([
            "@capacitor/core",
            `@capacitor/${platform}`,
            ...plugins.flatMap(({ manifest }) =>
              Object.keys(manifest.dependencies)
            ),
          ]),
        ].map((name) => ({
          name,
          directory: path.dirname(
            appRequire.resolve(`${name}/package.json`, {
              paths: [
                root,
                path.dirname(require.resolve("@capacitor/core/package.json")),
              ],
            })
          ),
        })),
      }),
      catch: (cause) =>
        new NativeToolchainUnavailable({
          message: `Install the enabled plugins' npm dependencies and @capacitor/core@8, @capacitor/${platform}@8 and @capacitor/cli@8 to generate a ${platform} shell: ${String(cause)}`,
        }),
    });
    const packages = yield* Effect.forEach(
      (entry: (typeof resolved.packages)[number]) =>
        fs.readFileString(path.join(entry.directory, "package.json")).pipe(
          Effect.flatMap(
            Schema.decodeEffect(
              Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
            )
          ),
          Effect.map(({ version }) => ({ ...entry, version }))
        )
    )(resolved.packages);
    for (const entry of packages) {
      for (const { manifest } of plugins) {
        const range = manifest.dependencies[entry.name];
        if (range !== undefined && !semver.satisfies(entry.version, range)) {
          return yield* new InvalidPlugin({
            message: `Plugin ${manifest.id} requires ${entry.name}@${range}, installed ${entry.version}`,
          });
        }
      }
    }
    return { cli: resolved.cli, packages };
  });
export const readNativeProject = (
  root: string,
  packageRoot: string,
  platform: "android" | "ios"
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { config, url, outputs } = yield* NativeMetadata.pipe(
      Effect.flatMap((metadata) => metadata.read(root)),
      Effect.provide(nativeMetadataLayer)
    );
    const bundled = config.mode === "bundled";
    const identity = nativeIdentity(config, platform);
    yield* Schema.decodeEffect(
      platform === "android" ? AndroidPackageIdSchema : IosBundleIdSchema
    )(identity.appId).pipe(
      Effect.mapError((error) => new InvalidConfig({ message: error.message }))
    );
    const assets = yield* prepareNativeAssets(root, config);
    const plugins = yield* resolvePlugins(config);
    const { origin } = new URL(url);
    const localOrigin =
      platform === "android" ? "https://localhost" : "capacitor://localhost";
    const origins = bundled
      ? [localOrigin]
      : [...new Set([origin, ...(config.allowlist ?? [])])];
    const { version } = yield* fs
      .readFileString(path.join(packageRoot, "package.json"))
      .pipe(
        Effect.flatMap(
          Schema.decodeEffect(
            Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
          )
        )
      );
    // Template seed only. Shells replace safeArea before writing any cookie.
    const cookie = yield* encodeNativeContextCookie({
      platform,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      shellVersion: version,
    });
    return {
      config,
      identity,
      assets,
      url: bundled ? localOrigin : url,
      bundled,
      outputs,
      origins,
      cookie,
      cookies: nativeCookiePlan(bundled ? [] : origins),
      plugins,
    };
  });
export const renderTemplate = (
  file: string,
  template: string,
  replacements: Readonly<Record<string, string>>
) =>
  Effect.gen(function* () {
    let source = template;
    for (const [anchor, replacement] of Object.entries(replacements)) {
      source = yield* replaceAnchor(file, source, anchor, replacement);
    }
    return source;
  });

export const generateNativeProject = <E, R>(
  root: string,
  platform: "android" | "ios",
  native: Effect.Success<ReturnType<typeof readNativeProject>>,
  customize: (staging: string) => Effect.Effect<void, E, R>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { cli, packages } = yield* capacitor(platform, native.plugins, root);
    const { config, url } = native;
    return yield* replaceProject(
      path.join(root, `.radical/${platform}`),
      (staging) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(
            path.join(staging, "node_modules/@capacitor"),
            { recursive: true }
          );
          for (const entry of packages) {
            yield* fs.makeDirectory(
              path.dirname(path.join(staging, "node_modules", entry.name)),
              { recursive: true }
            );
            yield* fs.symlink(
              entry.directory,
              path.join(staging, "node_modules", entry.name)
            );
          }
          yield* fs.makeDirectory(path.join(staging, "www"));
          if (native.bundled) {
            if (native.outputs?.spaShell === undefined) {
              return yield* new InvalidConfig({
                message:
                  "Bundled mode requires the adapter to report clientDir and spaShell outputs. Rebuild the app before generating the shell.",
              });
            }
            const client = path.resolve(root, native.outputs.clientDir);
            const shellPath = path.resolve(client, native.outputs.spaShell);
            const shell = yield* fs.readFileString(shellPath).pipe(
              Effect.mapError(
                () =>
                  new InvalidConfig({
                    message: `Bundled mode requires the adapter SPA shell at ${shellPath}. Rebuild the app before generating the shell.`,
                  })
              )
            );
            yield* fs.copy(client, path.join(staging, "www"), {
              overwrite: true,
            });
            yield* fs.writeFileString(
              path.join(staging, "www/index.html"),
              shell
            );
          } else {
            yield* fs.writeFileString(
              path.join(staging, "www/index.html"),
              "<!doctype html><title>Radical shell</title>"
            );
          }
          yield* fs.writeFileString(
            path.join(staging, "package.json"),
            JSON.stringify({
              name: config.appId,
              version: "0.0.0",
              // Capacitor discovers native plugins from this package, not the symlink alone.
              dependencies: Object.fromEntries(
                packages.map(({ name, version }) => [name, version])
              ),
            })
          );
          yield* fs.writeFileString(
            path.join(staging, "capacitor.config.json"),
            JSON.stringify({
              appId: native.identity.appId,
              appName: native.identity.name,
              webDir: "www",
              // Radical serves packaged startup/fallback pages to worker fetches.
              // Capacitor's default client would replace it during bridge setup.
              ...(platform === "android"
                ? {
                    android: {
                      resolveServiceWorkerRequests: false,
                      allowMixedContent:
                        native.bundled &&
                        config.origin?.startsWith("http:") === true,
                    },
                  }
                : {}),
              ...(platform === "ios"
                ? {
                    ios: {
                      limitsNavigationsToAppBoundDomains: !native.bundled,
                    },
                  }
                : {}),
              experimental: {
                ios: {
                  spm: {
                    packageOptions: {
                      "@capacitor-firebase/messaging": { symlink: true },
                    },
                  },
                },
              },
              plugins: {
                SystemBars: { insetsHandling: "disable" },
                ...Object.fromEntries(
                  native.plugins.flatMap(({ manifest }) =>
                    manifest.config
                      ? [
                          [
                            manifest.bridge,
                            config.pluginOptions?.[manifest.config.selector],
                          ],
                        ]
                      : []
                  )
                ),
              },
              server: {
                ...(native.bundled ? {} : { url }),
                cleartext: (config.origin ?? url).startsWith("http:"),
                allowNavigation:
                  platform === "android" || native.bundled
                    ? []
                    : native.origins.map((origin) => new URL(origin).hostname),
              },
            })
          );
          yield* execute(process.execPath, [cli, "add", platform], staging);
          yield* customize(staging);
          if (native.assets.length > 0) {
            const generator = yield* AssetGenerator;
            yield* generator.generate({
              project: staging,
              platform,
              assets: native.assets,
              backgroundColor: config.splash?.backgroundColor ?? "#ffffff",
            });
          }
          return yield* Effect.void;
        })
    );
  });
