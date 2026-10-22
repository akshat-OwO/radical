import path from "node:path";

import { Effect, FileSystem, Schema } from "effect";

import { cameraDeclarations } from "../../capabilities/camera/camera-declarations.ts";
import { configureNativeNotifications } from "../../capabilities/notifications/notification-native.ts";
import { safeAreaUpdateScript } from "../../capabilities/safe-area/shell-events.ts";
import { NATIVE_CONTEXT_COOKIE } from "../../core/context/native-context.ts";
import { offlineSnapshotCheckScript } from "../../core/offline/native-offline.ts";
import { savedOfflineURLKeys } from "../../core/offline/offline-protocol.ts";
import { resolvePackageRoot } from "../../vite/package-paths.ts";
import { pluginRegistration } from "../../vite/plugins/plugin-plan.ts";
import { composePluginSources } from "../../vite/plugins/plugin-sources.ts";
import {
  generateNativeProject,
  readNativeProject,
  renderTemplate,
} from "../shared/native-project.ts";
import { replaceAnchor } from "../shared/native-template.ts";
import { execute } from "../shared/shell.ts";
import { resolveAndroidTarget } from "./android-target.ts";

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
  packageRoot = resolvePackageRoot(import.meta.url)
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const native = yield* readNativeProject(root, packageRoot, "android");
    const camera = yield* cameraDeclarations(native.config);
    const { config, url, origins, cookie } = native;
    const template = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/MainActivity.java")
    );
    const gradleTemplate = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/radical.gradle")
    );
    const replacements: Record<string, string> = {
      __OFFLINE_LAUNCH__: JSON.stringify(
        yield* fs.readFileString(
          path.join(packageRoot, "templates/android/launch.html")
        )
      ),
      __OFFLINE_FALLBACK__: JSON.stringify(
        yield* fs.readFileString(
          path.join(packageRoot, "templates/offline.html")
        )
      ),
      __OFFLINE_SNAPSHOT_CHECK__: JSON.stringify(
        offlineSnapshotCheckScript(config.appId)
      ),
      __OFFLINE_SAVED_URL_KEY__: JSON.stringify(savedOfflineURLKeys.android),
      __BUNDLED__: String(native.bundled),
      __APP_ID__: native.identity.appId,
      __SAFE_AREA_SCRIPT__: JSON.stringify(safeAreaUpdateScript),
      __PLUGIN_REGISTRATION__: pluginRegistration(native.plugins, "android"),
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
        const manifestPath = path.join(
          staging,
          "android/app/src/main/AndroidManifest.xml"
        );
        const manifest = yield* fs.readFileString(manifestPath);
        yield* fs.writeFileString(
          manifestPath,
          yield* replaceAnchor(
            "AndroidManifest.xml",
            manifest,
            "</manifest>",
            `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />${camera.android}</manifest>`
          )
        );
        if (config.splash) {
          const styles = path.join(
            staging,
            "android/app/src/main/res/values/styles.xml"
          );
          yield* fs.writeFileString(
            styles,
            yield* replaceAnchor(
              styles,
              yield* fs.readFileString(styles),
              '<item name="android:background">@drawable/splash</item>',
              `<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenBackground">${config.splash.backgroundColor}</item>\n        <item name="windowSplashScreenAnimatedIcon">@drawable/radical_splash_icon</item>`
            )
          );
        }
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
            ...native.identity.appId.split("."),
            "MainActivity.java"
          ),
          activity
        );
        yield* configureNativeNotifications(root, staging, "android", config);
        yield* composePluginSources(
          staging,
          "android",
          native.identity.appId,
          native.plugins,
          root,
          packageRoot
        );
      })
    );
  });

export { AndroidBootTimeout } from "./errors.ts";
export { AndroidDeviceUnavailable } from "./errors.ts";

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
