import path from "node:path";

import { Effect, FileSystem, Schema } from "effect";

import { execute } from "../shared/shell.ts";
import { resolveAndroidTarget } from "./android-target.ts";

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
