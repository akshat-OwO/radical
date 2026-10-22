import { Effect } from "effect";

export const tanstackOutputs = Effect.succeed({
  clientDir: "dist/client",
  spaShell: "_shell.html",
});
