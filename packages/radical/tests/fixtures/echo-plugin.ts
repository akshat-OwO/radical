import { Schema } from "effect";

import { definePlugin } from "../../src/core/plugins/plugins.ts";

const text = Schema.Struct({ text: Schema.String });
/** Generation fixture uses the example's real Java and Swift source files. */
export const echo = definePlugin({
  id: "echo",
  bridge: "Echo",
  dependencies: {},
  config: {
    selector: "Echo",
    schema: Schema.Struct({ prefix: Schema.String }),
  },
  commands: { echo: { args: text, result: text, errors: {} } },
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
