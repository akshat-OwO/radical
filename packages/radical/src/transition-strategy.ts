import { Effect } from "effect";

import { Bridge } from "./bridge.ts";
import { BrowserTransitions } from "./browser-transitions.ts";

/** Shells always use snapshots, regardless of WebView browser capabilities. */
export const transitionStrategy = Effect.gen(function* () {
  const bridge = yield* Bridge;
  if ((yield* bridge.runtime) !== "browser") {
    return "native" as const;
  }
  const browser = yield* BrowserTransitions;
  return (yield* browser.supportsTypes)
    ? ("browser" as const)
    : ("plain" as const);
});
