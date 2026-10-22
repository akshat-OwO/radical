import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Layer, Predicate, Schema } from "effect";

import { resolveInternalPlugins } from "../../core/plugins/internal-plugin-registry.ts";
import { PluginManifestSchema } from "../../core/plugins/plugins.ts";
import type { PluginManifest } from "../../core/plugins/plugins.ts";
import type { RadicalConfig } from "../config.ts";
import { InvalidPlugin } from "./errors.ts";
import { resolvePluginDependencies } from "./plugin-dependencies.ts";
import { PluginModules } from "./plugin-modules.ts";
import { decodePluginOptions } from "./plugin-options.ts";

export { InvalidPlugin } from "./errors.ts";

export { PluginDependencyConflict } from "./errors.ts";

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
    !Predicate.isFunction(schema) ||
    !(schema.prototype instanceof Error) ||
    !("fields" in schema)
  ) {
    return false;
  }

  const { fields } = schema;

  if (!Schema.is(Schema.Struct({ _tag: Schema.Unknown }))(fields)) {
    return false;
  }

  return Schema.isSchema(fields._tag) && Schema.is(fields._tag)(code);
};

export interface EnabledPlugin {
  readonly manifest: PluginManifest;
  readonly module: string;
  readonly selector: string;
  readonly options?: unknown;
  /** Validated encoded input for Capacitor, preserving its public config and key order. */
  readonly encodedOptions?: unknown;
  /** Source directory relative to radical's package root. Omit for module-relative sources. */
  readonly sourceRoot?: string;
}

// oxlint-disable-next-line eslint/complexity -- Validate all manifest constraints before touching a project.
export const validatePlugins = (
  plugins: readonly EnabledPlugin[],
  options: NonNullable<RadicalConfig["pluginOptions"]> = {}
) =>
  Effect.gen(
    // oxlint-disable-next-line eslint/complexity -- Validate all manifest constraints before touching a project.
    function* () {
      const resolved: EnabledPlugin[] = [];
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

        resolved.push({
          ...entry,
          options: yield* decodePluginOptions(manifest, options),
          encodedOptions: manifest.config
            ? options[manifest.config.selector]
            : undefined,
        });

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

      return resolved;
    }
  );

export const resolvePlugins = (config: RadicalConfig) =>
  Effect.gen(function* () {
    const plugins: EnabledPlugin[] = resolveInternalPlugins(
      config.internalPlugins
    );

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
