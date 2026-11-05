import path from "node:path";

import { Effect, FileSystem, Schema } from "effect";

import { execute } from "../shared/shell.ts";

export class AndroidToolchainError extends Schema.TaggedError<AndroidToolchainError>()(
  "AndroidToolchainError",
  { message: Schema.String }
) {}

/** Exercise the installed wrapper and Groovy without Android SDK or plugin resolution.
 * --version alone succeeds even when Groovy cannot read the launcher's JDK classes.
 */
export const preflightAndroid = (cli: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const probe = yield* fs.makeTempDirectoryScoped({
        prefix: "radical-jdk-",
      });

      yield* execute(
        "tar",
        [
          "-xzf",
          path.resolve(path.dirname(cli), "../assets/android-template.tar.gz"),
          "-C",
          probe,
          "gradlew",
          "gradle/wrapper/gradle-wrapper.jar",
          "gradle/wrapper/gradle-wrapper.properties",
        ],
        probe
      );

      // Force fresh Groovy compilation rather than reusing a script compiled by
      // a compatible JDK from Gradle's shared script cache.
      yield* fs.writeFileString(
        path.join(probe, "settings.gradle"),
        `rootProject.name = ${JSON.stringify(path.basename(probe))}\n`
      );

      const wrapper = yield* fs.readFileString(
        path.join(probe, "gradle/wrapper/gradle-wrapper.properties")
      );

      const version =
        /gradle-(?<version>\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?)-(?:all|bin)\.zip/u.exec(
          wrapper
        )?.[1];

      const compatibility =
        version === undefined
          ? "the compatibility documentation for the distributionUrl in gradle/wrapper/gradle-wrapper.properties"
          : `https://docs.gradle.org/${version}/userguide/compatibility.html`;

      yield* execute(
        "./gradlew",
        ["help", "--no-daemon", "--console=plain"],
        probe
      ).pipe(
        Effect.catchTag("ShellCommandError", () =>
          Effect.fail(
            new AndroidToolchainError({
              message: `Android toolchain preflight failed before generation. See the Gradle error above. Check JAVA_HOME (or java on PATH) against the Gradle version in the installed Capacitor template: ${compatibility}. For an unsupported class file version, select a compatible installed JDK for this command, for example JDK 21 for Capacitor 8. Radical has not changed your Java configuration. Other failures, such as wrapper download or permissions errors, need the corresponding fix shown above; this probe does not load Radical or Android plugins.`,
            })
          )
        )
      );
    })
  );

/** Capacitor's cap add catches Gradle sync errors and can still exit successfully. */
export const verifyAndroidSync = (staging: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Capacitor only attempts its automatic sync when it writes local.properties.
    // Keep generation without an SDK available on hosts where it skips that step.
    if (!(yield* fs.exists(path.join(staging, "android/local.properties")))) {
      return;
    }

    yield* execute(
      "./gradlew",
      ["help", "--no-daemon", "--console=plain"],
      path.join(staging, "android")
    ).pipe(
      Effect.catchTag("ShellCommandError", () =>
        Effect.fail(
          new AndroidToolchainError({
            message:
              "Android Gradle sync failed. The generated project was not published. See the Gradle error above: check the selected daemon JDK, SDK and dependencies. A successful toolchain preflight only verifies the launcher and Gradle runtime; failures in Radical-generated configuration may still be Radical bugs.",
          })
        )
      ),
      Effect.asVoid
    );
  });
