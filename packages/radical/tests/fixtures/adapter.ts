import { Effect, Layer } from "effect";

import { RadicalAdapter } from "../../src/core/adapter/adapter.ts";
import { AdapterUnavailable } from "../../src/core/adapter/errors.ts";

export const adapterOutputs = {
  clientDir: "web/public",
  spaShell: "entry.html",
  exposedHeaders: ["x-example-result", "x-example-error"],
};

const unavailable = () =>
  Effect.fail(new AdapterUnavailable({ operation: "test" }));

export const fakeAdapter = Layer.succeed(RadicalAdapter, {
  name: "fake",
  routes: Effect.succeed([]),
  provideRequestContext: unavailable,
  navigation: Effect.succeed({
    navigate: unavailable,
    onBeforeNavigate: unavailable,
    onAfterNavigate: unavailable,
  }),
  outputs: Effect.succeed(adapterOutputs),
});
