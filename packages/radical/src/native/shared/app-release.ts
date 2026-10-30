import path from "node:path";

import { Config, Effect, FileSystem, Schema } from "effect";

import { InvalidConfig } from "../../vite/config.ts";
import type { RadicalConfig } from "../../vite/config.ts";

/** Resolve once per generation. CI owns the build counter. */
export const resolveAppRelease = (
  root: string,
  config: RadicalConfig,
  platform: "android" | "ios",
  cliBuild?: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const version =
      config.version ??
      (yield* fs.readFileString(path.join(root, "package.json")).pipe(
        Effect.flatMap(
          Schema.decodeEffect(
            Schema.fromJsonString(
              Schema.Struct({ version: Schema.NonEmptyString })
            )
          )
        ),
        Effect.map((metadata) => metadata.version),
        Effect.mapError(
          (error) =>
            new InvalidConfig({
              message: `Cannot read app version from package.json: ${error.message}`,
            })
        )
      ));

    const source = String(
      config.build ??
        cliBuild ??
        (yield* Config.String("RADICAL_BUILD").pipe(
          Config.withDefault(""),
          Effect.mapError(
            (error) => new InvalidConfig({ message: error.message })
          )
        ))
    );

    const build = /^[0-9]+$/u.test(source) ? Number(source) : Number.NaN;

    if (!Number.isSafeInteger(build) || build <= 0) {
      return yield* new InvalidConfig({
        message:
          "build must be a positive safe integer. Set config.build, --build, or RADICAL_BUILD.",
      });
    }

    if (platform === "android" && build > 2_100_000_000) {
      return yield* new InvalidConfig({
        message:
          "Android build must not exceed Google Play's versionCode limit of 2100000000.",
      });
    }

    if (platform === "ios" && !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(version)) {
      return yield* new InvalidConfig({
        message:
          "iOS version must contain three period-separated integers, for example 1.2.3.",
      });
    }

    return { version, build };
  });
