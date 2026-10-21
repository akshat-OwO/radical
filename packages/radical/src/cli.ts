#!/usr/bin/env node
import path from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, FileSystem, Schema } from "effect";
import { Command, Flag } from "effect/cli";

import { generateAndroid, runAndroid } from "./android.ts";
import { InvalidPlugin } from "./invalid-plugin.ts";
import { generateIos, runIos } from "./ios.ts";
import { assetGeneratorLayer } from "./native-assets.ts";
import { pluginModulesLayer } from "./plugin-plan.ts";

const prepareNative = Effect.gen(function* () {
  const vite = yield* Effect.tryPromise({
    try: () => import("vite"),
    catch: (cause) => new InvalidPlugin({ message: String(cause) }),
  });
  yield* Effect.tryPromise({
    try: () => vite.resolveConfig({}, "build", "production", "production"),
    catch: (cause) => new InvalidPlugin({ message: String(cause) }),
  });
  const fs = yield* FileSystem.FileSystem;
  const metadata = yield* fs.readFileString(
    path.join(process.cwd(), ".radical/native.json")
  );
  const { config } = yield* Schema.decodeEffect(
    Schema.fromJsonString(
      Schema.Struct({
        config: Schema.Struct({ mode: Schema.optional(Schema.String) }),
      })
    )
  )(metadata);
  if (config.mode === "bundled") {
    const builder = yield* Effect.tryPromise({
      try: () => vite.createBuilder({}),
      catch: (cause) => new InvalidPlugin({ message: String(cause) }),
    });
    yield* Effect.tryPromise({
      try: () => builder.buildApp(),
      catch: (cause) =>
        new InvalidPlugin({
          message: `Cannot build bundled UI: ${String(cause)}`,
        }),
    });
  }
});

const android = Command.make(
  "android",
  {
    generateOnly: Flag.Boolean("generate-only").pipe(Flag.withDefault(false)),
    target: Flag.String("target").pipe(Flag.withDefault("")),
  },
  ({ generateOnly, target }) =>
    prepareNative.pipe(
      Effect.andThen(generateAndroid(process.cwd())),
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
      Effect.andThen(generateIos(process.cwd())),
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
