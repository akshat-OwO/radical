import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem } from "effect";

// The checks that follow must resolve workspace source with no build artifacts.
Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(new URL("../dist", import.meta.url).pathname, {
    recursive: true,
    force: true,
  });
}).pipe(Effect.provide(NodeServices.layer), (program) => {
  NodeRuntime.runMain(program);
});
