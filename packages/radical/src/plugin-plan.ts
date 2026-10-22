import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Layer, Schema } from "effect";

import type { RadicalConfig } from "./config.ts";
import {
  googleSignInPlugin,
  dataProtectionPlugin,
  networkPlugin,
  appLauncherPlugin,
  localNotificationsPlugin,
  badgePlugin,
  firebaseMessagingPlugin,
  notificationTopicsPlugin,
  cameraPlugin,
  devicePlugin,
  fileOpenerPlugin,
  filePickerPlugin,
  hapticsPlugin,
  transitionsPlugin,
  videoStreamPlugin,
} from "./internal-plugins.ts";
import { InvalidPlugin } from "./invalid-plugin.ts";
import { resolvePluginDependencies } from "./plugin-dependencies.ts";
import { PluginModules } from "./plugin-modules.ts";
import { PluginManifestSchema } from "./plugins.ts";
import type { PluginManifest } from "./plugins.ts";

export { InvalidPlugin } from "./invalid-plugin.ts";
export { PluginDependencyConflict } from "./plugin-dependency-conflict.ts";
export { PluginModules } from "./plugin-modules.ts";
export const pluginModulesLayer = (root: string) =>
  Layer.succeed(PluginModules, {
    load: (module) =>
      Effect.tryPromise({
        try: () =>
          import(
            module.startsWith(".")
              ? pathToFileURL(path.resolve(root, module)).href
              : pathToFileURL(
                  createRequire(path.join(root, "package.json")).resolve(module)
                ).href
          ),
        catch: (cause) =>
          new InvalidPlugin({
            message: `Cannot load plugin manifest ${module}: ${String(cause)}`,
          }),
      }),
  });

const hasErrorTag = (schema: Schema.Codec<unknown, unknown>, code: string) => {
  if (
    typeof schema !== "function" ||
    !(schema.prototype instanceof Error) ||
    !("fields" in schema)
  ) {
    return false;
  }
  const { fields } = schema;
  if (typeof fields !== "object" || fields === null || !("_tag" in fields)) {
    return false;
  }
  return Schema.isSchema(fields._tag) && Schema.is(fields._tag)(code);
};

export interface EnabledPlugin {
  readonly manifest: PluginManifest;
  readonly module: string;
  readonly selector: string;
}
// oxlint-disable-next-line eslint/complexity -- Validate all manifest constraints before touching a project.
export const validatePlugins = (
  plugins: readonly EnabledPlugin[],
  options: Readonly<Record<string, unknown>> = {}
) =>
  Effect.gen(
    // oxlint-disable-next-line eslint/complexity -- Validate all manifest constraints before touching a project.
    function* () {
      const ids = new Set<string>();
      const bridges = new Set<string>();
      const classes = new Set<string>();
      const files = new Set<string>();
      for (const entry of plugins) {
        const manifest = yield* Schema.decodeUnknownEffect(
          PluginManifestSchema,
          { onExcessProperty: "error" }
        )(entry.manifest).pipe(
          Effect.mapError(
            (error) =>
              new InvalidPlugin({
                message: `Invalid plugin ${entry.module}: ${error.message}`,
              })
          )
        );
        if (ids.has(manifest.id) || bridges.has(manifest.bridge)) {
          return yield* new InvalidPlugin({
            message: `Duplicate plugin id or bridge: ${manifest.id} (${manifest.bridge})`,
          });
        }
        ids.add(manifest.id);
        bridges.add(manifest.bridge);
        if (Object.keys(manifest.commands).length === 0) {
          return yield* new InvalidPlugin({
            message: `Plugin ${manifest.id} declares no commands`,
          });
        }
        for (const [name, command] of Object.entries(manifest.commands)) {
          for (const [code, schema] of Object.entries(command.errors)) {
            if (!hasErrorTag(schema, code)) {
              return yield* new InvalidPlugin({
                message: `Plugin ${manifest.id}.${name}: error ${code} must be a Schema.TaggedError with matching tag`,
              });
            }
          }
        }
        if (manifest.config) {
          const value = options[manifest.config.selector];
          if (
            !Object.hasOwn(options, manifest.config.selector) ||
            value === undefined
          ) {
            return yield* new InvalidPlugin({
              message: `Plugin ${manifest.id}: config selector ${manifest.config.selector} does not resolve`,
            });
          }
          yield* Schema.decodeUnknownEffect(manifest.config.schema)(value).pipe(
            Effect.mapError(
              (error) =>
                new InvalidPlugin({
                  message: `Plugin ${manifest.id} config ${manifest.config?.selector}: ${error.message}`,
                })
            )
          );
        }
        for (const native of [manifest.android, manifest.ios]) {
          for (const source of native?.sources ?? []) {
            if (
              !/^[A-Za-z][A-Za-z0-9_]*\.(?:java|kt|swift)$/u.test(source.file)
            ) {
              return yield* new InvalidPlugin({
                message: `Plugin ${manifest.id}: invalid native source filename ${source.file}`,
              });
            }
          }
        }
        for (const platform of ["android", "ios"] as const) {
          const native = manifest[platform];
          if (!native) {
            continue;
          }
          const classKey = `${platform}:${native.className}`;
          if (classes.has(classKey)) {
            return yield* new InvalidPlugin({
              message: `Plugin ${manifest.id}: duplicate native class ${classKey}`,
            });
          }
          classes.add(classKey);
          for (const source of native.sources) {
            const key = `${platform}:${source.file}`;
            if (files.has(key)) {
              return yield* new InvalidPlugin({
                message: `Plugin ${manifest.id}: duplicate native source ${key}`,
              });
            }
            files.add(key);
            if (
              !(platform === "ios"
                ? source.file.endsWith(".swift")
                : /\.(?:java|kt)$/u.test(source.file))
            ) {
              return yield* new InvalidPlugin({
                message: `Plugin ${manifest.id}: wrong ${platform} source extension ${source.file}`,
              });
            }
          }
        }
      }
      yield* resolvePluginDependencies(plugins);
      return plugins;
    }
  );
const optInPlugins = [
  ["googleSignIn", googleSignInPlugin],
  ["dataProtection", dataProtectionPlugin],
  ["network", networkPlugin],
  ["notifications", localNotificationsPlugin],
  ["notifications", badgePlugin],
  ["pushNotifications", firebaseMessagingPlugin],
  ["pushNotifications", notificationTopicsPlugin],
  ["videoStream", videoStreamPlugin],
  ["camera", cameraPlugin],
  ["filePicker", filePickerPlugin],
  ["haptics", hapticsPlugin],
] as const;

const enabledInternalPlugins = (config: RadicalConfig) => {
  const notifications =
    config.internalPlugins?.notifications === true ||
    config.internalPlugins?.pushNotifications === true;
  return {
    ...config.internalPlugins,
    notifications,
    network: config.internalPlugins?.network === true || notifications,
  };
};

export const resolvePlugins = (config: RadicalConfig) =>
  Effect.gen(function* () {
    const plugins: EnabledPlugin[] = [];
    const internalPlugins = enabledInternalPlugins(config);
    for (const [flag, manifest] of optInPlugins) {
      if (internalPlugins[flag] === true) {
        plugins.push({
          manifest,
          module: "radical/internal-plugins",
          selector: `${manifest.id}Plugin`,
        });
      }
    }
    if (config.internalPlugins?.intents === true) {
      plugins.push(
        {
          manifest: appLauncherPlugin,
          module: "radical/internal-plugins",
          selector: "appLauncherPlugin",
        },
        {
          manifest: fileOpenerPlugin,
          module: "radical/internal-plugins",
          selector: "fileOpenerPlugin",
        }
      );
    }
    if (config.internalPlugins?.device !== false) {
      plugins.push({
        manifest: devicePlugin,
        module: "radical/internal-plugins",
        selector: "devicePlugin",
      });
    }
    if (config.internalPlugins?.transitions !== false) {
      plugins.push({
        manifest: transitionsPlugin,
        module: "radical/internal-plugins",
        selector: "transitionsPlugin",
      });
    }
    if ((config.plugins?.length ?? 0) > 0) {
      const modules = yield* PluginModules;
      for (const entry of config.plugins ?? []) {
        const selector = entry.selector ?? "default";
        const exports = yield* modules.load(entry.manifest);
        const manifest = yield* Schema.decodeUnknownEffect(
          PluginManifestSchema,
          { onExcessProperty: "error" }
        )(exports[selector]).pipe(
          Effect.mapError(
            (error) =>
              new InvalidPlugin({
                message: `Invalid plugin ${entry.manifest} selector ${selector}: ${error.message}`,
              })
          )
        );
        plugins.push({ manifest, module: entry.manifest, selector });
      }
    }
    return yield* validatePlugins(plugins, config.pluginOptions);
  });
export const pluginRegistration = (
  plugins: readonly EnabledPlugin[],
  platform: "android" | "ios"
) =>
  plugins
    .flatMap(({ manifest }) => {
      const native = manifest[platform];
      return native
        ? [
            platform === "android"
              ? `registerPlugin(${native.className}.class);`
              : `bridge?.registerPluginInstance(${native.className}())`,
          ]
        : [];
    })
    .join("\n        ");
