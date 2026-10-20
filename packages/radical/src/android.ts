import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, FileSystem, Schema } from "effect";

import { resolveAndroidTarget } from "./android-target.ts";
import { NATIVE_CONTEXT_COOKIE } from "./native-context.ts";
import {
  generateNativeProject,
  readNativeProject,
  renderTemplate,
} from "./native-project.ts";
import { safeAreaUpdateScript } from "./shell-events.ts";
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
      __OFFLINE_FALLBACK__: JSON.stringify(
        yield* fs.readFileString(
          path.join(packageRoot, "templates/android/offline.html")
        )
      ),
      __APP_ID__: config.appId,
      __SAFE_AREA_SCRIPT__: JSON.stringify(safeAreaUpdateScript),
      __URL__: JSON.stringify(url),
      __COOKIES__: native.cookies
        .map(
          ({ origin, secure }) =>
            `cookies.setCookie(${JSON.stringify(origin)}, COOKIE + ${JSON.stringify(`; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`)});`
        )
        .join("\n        "),
      __COOKIE__: JSON.stringify(`${NATIVE_CONTEXT_COOKIE}=${cookie}`),
      __ORIGINS__: origins.map((value) => JSON.stringify(value)).join(", "),
      __GUARD__: JSON.stringify(navigationGuardScript(origins)),
    };
    const activity = yield* renderTemplate(
      "MainActivity.java",
      template,
      replacements
    );
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

export { AndroidBootTimeout } from "./android-boot-timeout.ts";
export { AndroidDeviceUnavailable } from "./android-device-unavailable.ts";

export const runAndroid = (project: string, target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { adb, serial } = yield* resolveAndroidTarget(project, target);
    const { appId } = yield* fs
      .readFileString(path.join(project, "capacitor.config.json"))
      .pipe(
        Effect.flatMap(
          Schema.decodeEffect(
            Schema.fromJsonString(Schema.Struct({ appId: Schema.String }))
          )
        )
      );
    // native-run restarts the shared adb server after five seconds and can leave
    // its retry promise pending. Own the launch and its lifetime instead.
    yield* execute(
      "./gradlew",
      ["assembleDebug"],
      path.join(project, "android")
    ).pipe(
      Effect.ensuring(
        execute("./gradlew", ["--stop"], path.join(project, "android")).pipe(
          Effect.orDie
        )
      )
    );
    yield* execute(
      adb,
      [
        "-s",
        serial,
        "install",
        "-r",
        path.join(project, "android/app/build/outputs/apk/debug/app-debug.apk"),
      ],
      project
    );
    return yield* execute(
      adb,
      [
        "-s",
        serial,
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        `${appId}/.MainActivity`,
      ],
      project
    ).pipe(Effect.timeout("30 seconds"));
  });
