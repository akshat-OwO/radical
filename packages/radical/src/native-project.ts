import { createRequire } from "node:module";
import path from "node:path";

import { Effect, FileSystem, Schema } from "effect";

import { HttpOriginSchema, RadicalConfigSchema } from "./config.ts";
import { encodeNativeContextCookie } from "./native-context.ts";
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

export const capacitor = (platform: "android" | "ios") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const resolved = yield* Effect.try({
      try: () => ({
        cli: require.resolve("@capacitor/cli/bin/capacitor"),
        // One inclusion point until plugin manifests (#13). Resolve each package
        // explicitly: pnpm's platform package directory need not contain Device.
        packages: [
          "@capacitor/core",
          `@capacitor/${platform}`,
          "@capacitor/device",
        ].map((name) => ({
          name,
          directory: path.dirname(require.resolve(`${name}/package.json`)),
        })),
      }),
      catch: () =>
        new NativeToolchainUnavailable({
          message: `Install @capacitor/core@8, @capacitor/${platform}@8, @capacitor/device@8 and @capacitor/cli@8 to generate a ${platform} shell.`,
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
    return { cli: resolved.cli, packages };
  });
export const nativeConfigSchema = Schema.Struct({
  config: RadicalConfigSchema,
  url: HttpOriginSchema,
});
export const readNativeProject = (
  root: string,
  packageRoot: string,
  platform: "android" | "ios"
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const native = yield* fs.readFileString(
      path.join(root, ".radical/native.json")
    );
    const { config, url } = yield* Schema.decodeEffect(
      Schema.fromJsonString(nativeConfigSchema)
    )(native);
    const { origin } = new URL(url);
    const origins = [...new Set([origin, ...(config.allowlist ?? [])])];
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
    return { config, url, origins, cookie, cookies: nativeCookiePlan(origins) };
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
    const { cli, packages } = yield* capacitor(platform);
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
            yield* fs.symlink(
              entry.directory,
              path.join(staging, "node_modules", entry.name)
            );
          }
          yield* fs.makeDirectory(path.join(staging, "www"));
          yield* fs.writeFileString(
            path.join(staging, "www/index.html"),
            "<!doctype html><title>Radical shell</title>"
          );
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
              appId: config.appId,
              appName: config.appName ?? config.appId,
              webDir: "www",
              // Radical serves packaged startup/fallback pages to worker fetches.
              // Capacitor's default client would replace it during bridge setup.
              ...(platform === "android"
                ? { android: { resolveServiceWorkerRequests: false } }
                : {}),
              ...(platform === "ios"
                ? { ios: { limitsNavigationsToAppBoundDomains: true } }
                : {}),
              plugins: { SystemBars: { insetsHandling: "disable" } },
              server: {
                url,
                cleartext: url.startsWith("http:"),
                allowNavigation:
                  platform === "android"
                    ? []
                    : native.origins.map((origin) => new URL(origin).hostname),
              },
            })
          );
          yield* execute(process.execPath, [cli, "add", platform], staging);
          yield* customize(staging);
        })
    );
  });
