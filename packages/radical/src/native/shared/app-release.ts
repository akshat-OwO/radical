import path from "node:path";

import { Config, Console, Effect, FileSystem, Option, Schema } from "effect";

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

    const env = yield* Config.String("RADICAL_BUILD").pipe(
      Config.option,
      Effect.mapError((error) => new InvalidConfig({ message: error.message }))
    );

    // The most specific source wins, so CI can override a build kept in config.
    const source =
      cliBuild ??
      Option.getOrUndefined(env.pipe(Option.filter((value) => value !== ""))) ??
      (config.build === undefined ? undefined : String(config.build));

    if (source === undefined) {
      yield* Console.log(
        "No build set; using 1. Set --build, RADICAL_BUILD, or config.build before uploading to a store."
      );
    }

    const digits = source ?? "1";
    const build = /^[0-9]+$/u.test(digits) ? Number(digits) : Number.NaN;

    if (!Number.isSafeInteger(build) || build <= 0) {
      return yield* new InvalidConfig({
        message:
          "build must be a positive safe integer. Set --build, RADICAL_BUILD, or config.build.",
      });
    }

    if (platform === "android" && build > 2_100_000_000) {
      return yield* new InvalidConfig({
        message:
          "Android build must not exceed Google Play's versionCode limit of 2100000000.",
      });
    }

    if (platform === "ios" && !/^[0-9]+(?:\.[0-9]+){0,2}$/u.test(version)) {
      return yield* new InvalidConfig({
        message:
          "iOS version must be one to three period-separated integers, for example 1.2.3.",
      });
    }

    return { version, build };
  });
