import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, FileSystem } from "effect";
import { Argument, Command } from "effect/cli";

import { resolveRelease, stampManifest } from "./release-model.ts";

const resolve = Command.make(
  "resolve",
  { version: Argument.String("version") },
  ({ version }) =>
    resolveRelease(version).pipe(
      Effect.flatMap((release) =>
        Console.log(
          Object.entries(release)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join("\n")
        )
      )
    )
);

const stamp = Command.make(
  "stamp",
  { version: Argument.String("version") },
  ({ version }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = fileURLToPath(new URL("../package.json", import.meta.url));
      const source = yield* fs.readFileString(file);
      const stamped = yield* stampManifest(source, version);
      yield* fs.writeFileString(file, stamped);
    })
);

Command.run(
  Command.make("release").pipe(Command.withSubcommands([resolve, stamp])),
  {
    version: "0.0.0",
  }
).pipe(Effect.provide(NodeServices.layer), (program) => {
  NodeRuntime.runMain(program);
});
