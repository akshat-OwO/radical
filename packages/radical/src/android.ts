import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, FileSystem } from "effect";

import { NATIVE_CONTEXT_COOKIE } from "./native-context.ts";
import {
  capacitor,
  generateNativeProject,
  readNativeProject,
  renderTemplate,
} from "./native-project.ts";
import { execute } from "./shell.ts";

/**
 * Runs at document start, before any page script, in every frame. A top-level
 * document outside the allowlist stops parsing, so none of its scripts run,
 * even when it arrives through a redirect that native callbacks see too late.
 */
export const navigationGuardScript = (origins: readonly string[]) =>
  `(() => {
  if (window.top !== window) return;
  if (new Set(${JSON.stringify(origins)}).has(location.origin)) return;
  window.stop();
  document.documentElement.replaceChildren();
})();`;

export const generateAndroid = (
  root: string,
  packageRoot = fileURLToPath(new URL("../", import.meta.url))
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const native = yield* readNativeProject(root, packageRoot, "android");
    const { config, url, origins, cookie } = native;
    const template = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/MainActivity.java")
    );
    const gradleTemplate = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/radical.gradle")
    );
    const replacements: Record<string, string> = {
      __APP_ID__: config.appId,
      __URL__: JSON.stringify(url),
      __COOKIE__: JSON.stringify(`${NATIVE_CONTEXT_COOKIE}=${cookie}`),
      __ORIGINS__: origins.map((value) => JSON.stringify(value)).join(", "),
      __GUARD__: JSON.stringify(navigationGuardScript(origins)),
    };
    const activity = renderTemplate(template, replacements);
    return yield* generateNativeProject(root, "android", native, (staging) =>
      Effect.gen(function* () {
        const appGradle = path.join(staging, "android/app/build.gradle");
        const gradle = yield* fs.readFileString(appGradle);
        yield* fs.writeFileString(
          path.join(staging, "android/app/radical.gradle"),
          gradleTemplate
        );
        yield* fs.writeFileString(
          appGradle,
          `${gradle}\napply from: 'radical.gradle'\n`
        );
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
    const { cli } = yield* capacitor("android");
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
