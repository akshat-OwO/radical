#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";

import { generateAndroid, runAndroid } from "../native/android/android.ts";
import { assetGeneratorLayer } from "../native/assets/native-assets.ts";
import { generateIos, runIos } from "../native/ios/ios.ts";
import { InvalidPlugin } from "../vite/plugins/errors.ts";
import { pluginModulesLayer } from "../vite/plugins/plugin-plan.ts";
import { prepareNative } from "./prepare-native.ts";

const android = Command.make(
  "android",
  {
    generateOnly: Flag.Boolean("generate-only").pipe(Flag.withDefault(false)),
    target: Flag.String("target").pipe(Flag.withDefault("")),
  },
  ({ generateOnly, target }) =>
    prepareNative.pipe(
      Effect.flatMap((plan) => generateAndroid(process.cwd(), undefined, plan)),
      Effect.flatMap((project) =>
        generateOnly ? Effect.void : runAndroid(project, target)
      )
    )
);
const ios = Command.make(
  "ios",
  {
    generateOnly: Flag.Boolean("generate-only").pipe(Flag.withDefault(false)),
    target: Flag.String("target").pipe(Flag.withDefault("")),
  },
  ({ generateOnly, target }) =>
    prepareNative.pipe(
      Effect.flatMap((plan) => generateIos(process.cwd(), undefined, plan)),
      Effect.flatMap((project) =>
        generateOnly ? Effect.void : runIos(project, target)
      )
    )
);
const typegen = Command.make("typegen", {}, () =>
  Effect.tryPromise({
    try: () => import("vite"),
    catch: (cause) => new InvalidPlugin({ message: String(cause) }),
  }).pipe(
    Effect.flatMap(({ resolveConfig }) =>
      Effect.tryPromise({
        try: () => resolveConfig({}, "build"),
        catch: (cause) =>
          new InvalidPlugin({
            message: `Cannot generate plugin types: ${String(cause)}`,
          }),
      })
    )
  )
);
const cli = Command.make("radical").pipe(
  Command.withSubcommands([android, ios, typegen])
);
Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.provide(
    Layer.mergeAll(
      pluginModulesLayer(process.cwd()),
      assetGeneratorLayer,
      NodeServices.layer
    )
  ),
  (program) => {
    NodeRuntime.runMain(program);
  }
);
