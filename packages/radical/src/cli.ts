#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";

import { generateAndroid, runAndroid } from "./android.ts";

const android = Command.make(
  "android",
  {
    generateOnly: Flag.Boolean("generate-only").pipe(Flag.withDefault(false)),
    target: Flag.String("target").pipe(Flag.withDefault("")),
  },
  ({ generateOnly, target }) =>
    generateAndroid(process.cwd()).pipe(
      Effect.flatMap((project) =>
        generateOnly ? Effect.void : runAndroid(project, target)
      )
    )
);
const cli = Command.make("radical").pipe(Command.withSubcommands([android]));
Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  (program) => {
    NodeRuntime.runMain(program);
  }
);
