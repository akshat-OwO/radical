import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, FileSystem, Schema } from "effect";

import { HttpOriginSchema, RadicalConfigSchema } from "./config.ts";
import {
  encodeNativeContextCookie,
  NATIVE_CONTEXT_COOKIE,
} from "./native-context.ts";
import { execute, replaceProject } from "./shell.ts";

const require = createRequire(import.meta.url);

export class AndroidToolchainUnavailable extends Schema.TaggedError<
  AndroidToolchainUnavailable,
  { readonly brand: unique symbol }
>()("AndroidToolchainUnavailable", { message: Schema.String }) {}

const capacitor = Effect.try({
  try: () => ({
    cli: require.resolve("@capacitor/cli/bin/capacitor"),
    modules: path.join(
      path.dirname(require.resolve("@capacitor/android/package.json")),
      "../.."
    ),
  }),
  catch: () =>
    new AndroidToolchainUnavailable({
      message:
        "Install @capacitor/core@8, @capacitor/android@8 and @capacitor/cli@8 to generate an Android shell.",
    }),
});
export const nativeConfigSchema = Schema.Struct({
  config: RadicalConfigSchema,
  url: HttpOriginSchema,
});

export const generateAndroid = (
  root: string,
  packageRoot = fileURLToPath(new URL("../", import.meta.url))
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
    // Real insets arrive with safe-area support (#7); the shell pads the WebView until then.
    const cookie = yield* encodeNativeContextCookie({
      platform: "android",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      shellVersion: version,
    });
    const template = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/MainActivity.java")
    );
    const replacements: Record<string, string> = {
      __APP_ID__: config.appId,
      __URL__: JSON.stringify(url),
      __COOKIE__: JSON.stringify(`${NATIVE_CONTEXT_COOKIE}=${cookie}`),
      __ORIGINS__: origins.map((value) => JSON.stringify(value)).join(", "),
    };
    const activity = template.replaceAll(
      /__[A-Z_]+__/gu,
      (key) => replacements[key] ?? key
    );
    const { cli, modules } = yield* capacitor;
    return yield* replaceProject(
      path.join(root, ".radical/android"),
      (staging) =>
        Effect.gen(function* () {
          yield* fs.symlink(modules, path.join(staging, "node_modules"));
          yield* fs.makeDirectory(path.join(staging, "www"));
          yield* fs.writeFileString(
            path.join(staging, "www/index.html"),
            "<!doctype html><title>Radical shell</title>"
          );
          yield* fs.writeFileString(
            path.join(staging, "package.json"),
            JSON.stringify({ name: config.appId, version: "0.0.0" })
          );
          yield* fs.writeFileString(
            path.join(staging, "capacitor.config.json"),
            JSON.stringify({
              appId: config.appId,
              appName: config.appName ?? config.appId,
              webDir: "www",
              server: {
                url,
                cleartext: url.startsWith("http:"),
                allowNavigation: [],
              },
            })
          );
          yield* execute(process.execPath, [cli, "add", "android"], staging);
          yield* fs.writeFileString(
            path.join(
              staging,
              "android/app/src/main/java",
              ...config.appId.split("."),
              "MainActivity.java"
            ),
            activity
          );
        })
    );
  });

export const runAndroid = (project: string, target: string) =>
  Effect.gen(function* () {
    const { cli } = yield* capacitor;
    yield* execute(
      process.execPath,
      [cli, "run", "android", ...(target ? ["--target", target] : [])],
      project
    ).pipe(
      Effect.ensuring(
        execute("./gradlew", ["--stop"], path.join(project, "android")).pipe(
          Effect.orDie
        )
      )
    );
  });
