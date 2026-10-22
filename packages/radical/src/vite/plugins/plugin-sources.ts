import { createRequire } from "node:module";
import path from "node:path";

import { Effect, FileSystem } from "effect";

import { savedOfflineURLKeys } from "../../core/offline/offline-protocol.ts";
import { replaceAnchor } from "../../native/shared/native-template.ts";
import { InvalidPlugin } from "./errors.ts";
import {
  resolvePluginDependencies,
  swiftPackageIdentity,
} from "./plugin-dependencies.ts";
import type { EnabledPlugin } from "./plugin-plan.ts";

export const composePluginSources = (
  staging: string,
  platform: "android" | "ios",
  appId: string,
  plugins: readonly EnabledPlugin[],
  root: string,
  packageRoot: string
) =>
  Effect.gen(
    // oxlint-disable-next-line eslint/complexity -- Platform composition handles both native project formats.
    function* () {
      const fs = yield* FileSystem.FileSystem;
      const versions = yield* resolvePluginDependencies(plugins);
      const swift: string[] = [];
      let kotlin = false;
      const gradle = new Map<string, string>();
      const spm = new Map<string, { version: string; products: Set<string> }>();

      for (const { manifest, module, sourceRoot } of plugins) {
        const native = manifest[platform];

        if (platform === "android" && native && native.sources.length > 0) {
          const sourceClasses = native.sources.map(({ file }) =>
            path.basename(file, path.extname(file))
          );

          if (
            !sourceClasses.some(
              (name) =>
                native.className === name ||
                native.className === `${appId}.${name}`
            )
          ) {
            return yield* new InvalidPlugin({
              message: `Plugin ${manifest.id}: android class ${native.className} must match a copied source class in package ${appId}: ${sourceClasses.map((name) => `${appId}.${name}`).join(", ")}`,
            });
          }
        }

        if (
          platform === "android" &&
          native?.sources.length === 0 &&
          !native.className.includes(".")
        ) {
          return yield* new InvalidPlugin({
            message: `Plugin ${manifest.id}: android class ${native.className} with empty sources must name a fully qualified dependency-provided class`,
          });
        }

        let manifestDirectory = path.resolve(packageRoot, sourceRoot ?? ".");

        if (sourceRoot === undefined) {
          const resolved = module.startsWith(".")
            ? path.resolve(root, module)
            : yield* Effect.try({
                try: () =>
                  createRequire(path.join(root, "package.json")).resolve(
                    module
                  ),
                catch: (cause) =>
                  new InvalidPlugin({
                    message: `Cannot resolve ${module}: ${String(cause)}`,
                  }),
              });

          manifestDirectory = path.dirname(resolved);
        }

        const sources = yield* Effect.forEach(
          (source: { file: string; source: string }) =>
            fs
              .readFileString(path.resolve(manifestDirectory, source.source))
              .pipe(
                Effect.flatMap((content) =>
                  module === "@akshatowo/radical/internal-plugins" &&
                  content.includes("__OFFLINE_SAVED_URL_KEY__")
                    ? replaceAnchor(
                        source.file,
                        content,
                        "__OFFLINE_SAVED_URL_KEY__",
                        JSON.stringify(savedOfflineURLKeys[platform])
                      )
                    : Effect.succeed(content)
                ),
                Effect.map((content) => ({ ...source, content })),
                Effect.mapError(
                  (cause) =>
                    new InvalidPlugin({
                      message: `Plugin ${manifest.id}: cannot read ${source.source}: ${cause.message}`,
                    })
                )
              )
        )(native?.sources ?? []);

        const contents = sources.map((source) => source.content).join("\n");

        if (sources.length > 0) {
          const pattern =
            platform === "ios"
              ? /CAPPluginMethod\s*\(\s*name:\s*"(?<command>[A-Za-z][A-Za-z0-9_]*)"/gu
              : /@PluginMethod(?:\s*\([^)]*\))?\s+(?:public\s+void\s+|(?:public\s+)?fun\s+)(?<command>[A-Za-z][A-Za-z0-9_]*)\s*\(/gu;

          const exposed = new Set(
            [...contents.matchAll(pattern)].map(
              (match) => match.groups?.command
            )
          );

          for (const command of Object.keys(manifest.commands)) {
            if (!exposed.has(command)) {
              return yield* new InvalidPlugin({
                message: `Plugin ${manifest.id}: ${platform} native source does not expose command ${command}`,
              });
            }
          }

          for (const command of exposed) {
            if (
              command !== undefined &&
              !Object.hasOwn(manifest.commands, command)
            ) {
              return yield* new InvalidPlugin({
                message: `Plugin ${manifest.id}: ${platform} command ${command} is not declared in the manifest`,
              });
            }
          }
        }

        for (const source of sources) {
          if (platform === "ios") {
            swift.push(source.content);
          } else {
            kotlin ||= source.file.endsWith(".kt");

            const directory = path.join(
              staging,
              "android/app/src/main/java",
              ...appId.split(".")
            );

            yield* fs.makeDirectory(directory, { recursive: true });
            yield* fs.writeFileString(
              path.join(directory, source.file),
              `package ${appId};\n${source.content}`
            );
          }
        }

        for (const name of Object.keys(manifest.android?.dependencies ?? {})) {
          gradle.set(name, versions.get(`gradle:${name}`) ?? "");
        }

        for (const dependency of manifest.ios?.dependencies ?? []) {
          spm.set(dependency.url, {
            ...dependency,
            version: versions.get(`spm:${dependency.url}`) ?? "",
            products: new Set([
              ...(spm.get(dependency.url)?.products ?? []),
              dependency.product,
            ]),
          });
        }
      }

      if (platform === "android" && kotlin) {
        const rootGradle = path.join(staging, "android/build.gradle");
        yield* fs.writeFileString(
          rootGradle,
          yield* replaceAnchor(
            rootGradle,
            yield* fs.readFileString(rootGradle),
            "dependencies {",
            'dependencies {\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21"'
          )
        );
        const appGradle = path.join(staging, "android/app/build.gradle");
        yield* fs.writeFileString(
          appGradle,
          `${yield* fs.readFileString(appGradle)}\napply plugin: 'org.jetbrains.kotlin.android'\nkotlin { jvmToolchain(21) }\n`
        );
      }

      if (platform === "android" && gradle.size > 0) {
        const file = path.join(staging, "android/app/radical.gradle");
        yield* fs.writeFileString(
          file,
          `${yield* fs.readFileString(file)}\ndependencies {\n${[...gradle].map(([name, version]) => `implementation "${name}:${version}"`).join("\n")}\n}`
        );
      }

      if (platform === "ios") {
        const file = path.join(staging, "ios/App/App/AppDelegate.swift");
        yield* fs.writeFileString(
          file,
          `${yield* fs.readFileString(file)}\n${swift.join("\n")}`
        );

        if (spm.size > 0) {
          const packageFile = path.join(
            staging,
            "ios/App/CapApp-SPM/Package.swift"
          );

          let contents = yield* fs.readFileString(packageFile);
          contents = yield* replaceAnchor(
            packageFile,
            contents,
            /^ {4}dependencies: \[$/mu,
            `    dependencies: [\n${[...spm].map(([url, dep]) => `.package(url: ${JSON.stringify(url)}, exact: ${JSON.stringify(dep.version)}),`).join("\n")}`
          );
          contents = yield* replaceAnchor(
            packageFile,
            contents,
            '.product(name: "Cordova", package: "capacitor-swift-pm")',
            `.product(name: "Cordova", package: "capacitor-swift-pm"),\n${[...spm].flatMap(([url, dep]) => [...dep.products].map((product) => `.product(name: ${JSON.stringify(product)}, package: ${JSON.stringify(swiftPackageIdentity(url))})`)).join(",\n")}`
          );
          yield* fs.writeFileString(packageFile, contents);
        }
      }

      return yield* Effect.void;
    }
  );
