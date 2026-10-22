// oxlint-disable unicorn/throw-new-error -- Schema.TaggedError is an Effect factory.
import { Schema } from "effect";
import { definePlugin } from "radical/plugins";

export class EchoRejected extends Schema.TaggedError<EchoRejected>()(
  "EchoRejected",
  { reason: Schema.String }
) {}

export default definePlugin({
  id: "echo",
  bridge: "Echo",
  dependencies: {},
  config: {
    selector: "Echo",
    schema: Schema.Struct({ prefix: Schema.String }),
  },
  commands: {
    echo: {
      args: Schema.Struct({ text: Schema.String }),
      result: Schema.Struct({ text: Schema.String }),
      errors: { EchoRejected },
    },
  },
  android: {
    className: "EchoPlugin",
    sources: [{ file: "EchoPlugin.java", source: "EchoPlugin.java" }],
    dependencies: {},
  },
  ios: {
    className: "EchoPlugin",
    sources: [{ file: "EchoPlugin.swift", source: "EchoPlugin.swift" }],
    dependencies: [],
  },
});
