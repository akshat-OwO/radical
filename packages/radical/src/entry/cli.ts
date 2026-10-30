#!/usr/bin/env node
import { Context, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/cli";

import { generateAndroid } from "../native/android/generate.ts";
import { runAndroid } from "../native/android/run.ts";
import { generateIos } from "../native/ios/generate.ts";
import { runIos } from "../native/ios/run.ts";
import { CliVite, prepareNative } from "./prepare-native.ts";

/** Native generation and launch retain their filesystem and process requirements. */
export class CliNative extends Context.Service<
  CliNative,
  {
    readonly generateAndroid: typeof generateAndroid;
    readonly generateIos: typeof generateIos;
    readonly runAndroid: typeof runAndroid;
    readonly runIos: typeof runIos;
  }
>()("radical/CliNative") {}

export const cliNativeLayer = Layer.succeed(CliNative, {
  generateAndroid,
  generateIos,
  runAndroid,
  runIos,
});

export const makeCli = (root: string) => {
  const android = Command.make(
    "android",
    {
      build: Flag.String("build").pipe(Flag.optional),
      generateOnly: Flag.Boolean("generate-only").pipe(Flag.withDefault(false)),
      target: Flag.String("target").pipe(Flag.withDefault("")),
    },
    ({ build, generateOnly, target }) =>
      prepareNative.pipe(
        Effect.flatMap((plan) =>
          CliNative.pipe(
            Effect.flatMap((native) =>
              native.generateAndroid(
                root,
                undefined,
                plan,
                Option.getOrUndefined(build)
              )
            )
          )
        ),
        Effect.flatMap((project) =>
          generateOnly
            ? Effect.void
            : CliNative.pipe(
                Effect.flatMap((native) => native.runAndroid(project, target))
              )
        )
      )
  );

  const ios = Command.make(
    "ios",
    {
      build: Flag.String("build").pipe(Flag.optional),
      generateOnly: Flag.Boolean("generate-only").pipe(Flag.withDefault(false)),
      target: Flag.String("target").pipe(Flag.withDefault("")),
    },
    ({ build, generateOnly, target }) =>
      prepareNative.pipe(
        Effect.flatMap((plan) =>
          CliNative.pipe(
            Effect.flatMap((native) =>
              native.generateIos(
                root,
                undefined,
                plan,
                Option.getOrUndefined(build)
              )
            )
          )
        ),
        Effect.flatMap((project) =>
          generateOnly
            ? Effect.void
            : CliNative.pipe(
                Effect.flatMap((native) => native.runIos(project, target))
              )
        )
      )
  );

  const typegen = Command.make("typegen", {}, () =>
    CliVite.pipe(Effect.flatMap((vite) => vite.resolve(true)))
  );

  return Command.make("radical").pipe(
    Command.withSubcommands([android, ios, typegen])
  );
};
