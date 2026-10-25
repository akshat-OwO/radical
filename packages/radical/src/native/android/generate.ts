import path from "node:path";

import { Effect, FileSystem } from "effect";

import { NATIVE_CONTEXT_COOKIE } from "../../core/context/native-context.ts";
import { offlineSnapshotCheckScript } from "../../core/offline/native-offline.ts";
import { savedOfflineURLKeys } from "../../core/offline/offline-protocol.ts";
import type { BuildPlan } from "../../vite/build-plan.ts";
import { resolvePackageRoot } from "../../vite/package-paths.ts";
import { pluginRegistration } from "../../vite/plugins/plugin-plan.ts";
import { composePluginSources } from "../../vite/plugins/plugin-sources.ts";
import { prepareSectionDrawables } from "../assets/native-assets.ts";
import { applyBuildPlan } from "../shared/apply-build-plan.ts";
import {
  generateNativeProject,
  readNativeProject,
  renderTemplate,
} from "../shared/native-project.ts";
import {
  NativeTemplateMismatch,
  replaceAnchor,
} from "../shared/native-template.ts";
import {
  safeAreaUpdateScript,
  windowLayoutUpdateScript,
} from "../shared/shell-events.ts";

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
  packageRoot = resolvePackageRoot(import.meta.url),
  plan?: BuildPlan
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const native = yield* readNativeProject(root, packageRoot, "android", plan);
    const { config, url, origins, cookie } = native;

    const template = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/MainActivity.java")
    );

    const gradleTemplate = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/radical.gradle")
    );

    const daemonJvmTemplate = yield* fs.readFileString(
      path.join(packageRoot, "templates/android/gradle-daemon-jvm.properties")
    );

    const { navigation } = native.plan;

    const drawables = navigation
      ? yield* prepareSectionDrawables(root, navigation.sections)
      : [];

    const replacements = {
      __NAVIGATION_FIELD__: navigation ? "RadicalNavigation navigation;" : "",
      __NAVIGATION_REGISTRATION__: navigation
        ? "registerPlugin(RadicalNavigationPlugin.class);"
        : "",
      __NAVIGATION_SETUP__: navigation
        ? "navigation = new RadicalNavigation(this, view);"
        : "",
      __NAVIGATION_LAYOUT__: navigation
        ? "if (navigation != null) bars = navigation.layout(bars, keyboardVisible, width, displayFeatures);"
        : "",
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
      __WINDOW_LAYOUT_SCRIPT__: JSON.stringify(windowLayoutUpdateScript),
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
        if (navigation) {
          const java = path.join(
            staging,
            "android/app/src/main/java",
            ...native.identity.appId.split(".")
          );

          for (const file of [
            "RadicalNavigation.java",
            "RadicalNavigationPlugin.java",
          ]) {
            const source = yield* fs.readFileString(
              path.join(packageRoot, "templates/android", file)
            );

            const rendered =
              file === "RadicalNavigation.java"
                ? yield* renderTemplate(file, source, {
                    __SECTION_IDS__: navigation.sections
                      .map((section) => JSON.stringify(section.id))
                      .join(", "),
                    __SECTION_TITLES__: navigation.sections
                      .map((section) => JSON.stringify(section.title))
                      .join(", "),
                    __SECTION_ICONS__: navigation.sections
                      .map((_, index) => `R.drawable.radical_section_${index}`)
                      .join(", "),
                    __SECTION_SELECTED_ICONS__: navigation.sections
                      .map(
                        (_, index) =>
                          `R.drawable.radical_section_${index}_selected`
                      )
                      .join(", "),
                  })
                : source;

            yield* fs.writeFileString(
              path.join(java, file),
              `package ${native.identity.appId};\n${rendered}`
            );
          }

          const res = path.join(staging, "android/app/src/main/res/drawable");
          yield* fs.makeDirectory(res, { recursive: true });

          for (const drawable of drawables) {
            yield* fs.writeFileString(
              path.join(res, drawable.file),
              drawable.xml
            );
          }

          const styles = path.join(
            staging,
            "android/app/src/main/res/values/styles.xml"
          );

          yield* fs.writeFileString(
            styles,
            yield* replaceAnchor(
              styles,
              yield* fs.readFileString(styles),
              "Theme.AppCompat.DayNight.NoActionBar",
              "Theme.Material3.DayNight.NoActionBar"
            )
          );
        }

        const daemonJvmPath = path.join(
          staging,
          "android/gradle/gradle-daemon-jvm.properties"
        );

        yield* fs
          .writeFileString(daemonJvmPath, daemonJvmTemplate, { flag: "wx" })
          .pipe(
            Effect.mapError((error) =>
              error.reason._tag === "AlreadyExists"
                ? new NativeTemplateMismatch({
                    file: daemonJvmPath,
                    anchor: "absent Gradle daemon JVM criteria file",
                  })
                : error
            )
          );

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
            `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />${native.plan.android.declarations.join("")}</manifest>`
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
          navigation
            ? `${gradleTemplate}\ndependencies { implementation "com.google.android.material:material:1.14.0" }\n`
            : gradleTemplate
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
        yield* applyBuildPlan(root, staging, "android", native.plan);
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
