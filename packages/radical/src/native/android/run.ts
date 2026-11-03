import path from "node:path";

import { Console, Effect, FileSystem, Schema } from "effect";

import { execute } from "../shared/shell.ts";
import { resolveAndroidTarget } from "./android-target.ts";

export { AndroidBootTimeout } from "./errors.ts";

export { AndroidDeviceUnavailable } from "./errors.ts";

export const runAndroid = (project: string, target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { adb, serial } = yield* resolveAndroidTarget(project, target);

    const { appId, verifiedLinkHost } = yield* fs
      .readFileString(path.join(project, "capacitor.config.json"))
      .pipe(
        Effect.flatMap(
          Schema.decodeEffect(
            Schema.fromJsonString(
              Schema.Struct({
                appId: Schema.String,
                verifiedLinkHost: Schema.optional(Schema.String),
              })
            )
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

    if (verifiedLinkHost !== undefined) {
      yield* Effect.gen(function* () {
        const sdk = yield* execute(
          adb,
          ["-s", serial, "shell", "getprop", "ro.build.version.sdk"],
          project,
          { capture: true }
        );

        const version = yield* Schema.decodeUnknownEffect(
          Schema.NumberFromString
        )(sdk.trim());

        yield* execute(
          adb,
          [
            "-s",
            serial,
            "shell",
            "pm",
            ...(version >= 31
              ? ["set-app-links", "--package", appId, "2", verifiedLinkHost]
              : ["set-app-link", appId, "always"]),
          ],
          project
        );
      }).pipe(
        Effect.catch((error) =>
          Console.warn(
            `Could not approve verified links for ${verifiedLinkHost}: ${error.message}`
          )
        )
      );
    }

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
