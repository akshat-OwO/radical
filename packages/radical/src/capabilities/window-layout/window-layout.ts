import { Effect, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import { WindowLayoutSchema } from "../../core/context/native-context.ts";
import type { WindowLayout } from "../../core/context/native-context.ts";

const isWindowLayout = Schema.is(WindowLayoutSchema);

interface WidthQuery {
  readonly matches: boolean;
  readonly addEventListener: (type: "change", listener: () => void) => void;
  readonly removeEventListener: (type: "change", listener: () => void) => void;
}

/** Native events replay the latest layout; browsers observe the two width breakpoints. */
export const subscribeWindowLayout = (
  receive: (layout: WindowLayout) => void,
  matchMedia: (query: string) => WidthQuery = (query) =>
    window.matchMedia(query)
) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;

    if ((yield* bridge.runtime) !== "browser") {
      return yield* bridge.observe("radicalWindowLayout", (value) => {
        if (isWindowLayout(value)) {
          receive(value);
        }
      });
    }

    return yield* Effect.sync(() => {
      const medium = matchMedia("(min-width: 600px)");
      const expanded = matchMedia("(min-width: 840px)");

      const measure = () => {
        let widthClass: WindowLayout["widthClass"] = "compact";

        if (expanded.matches) {
          widthClass = "expanded";
        } else if (medium.matches) {
          widthClass = "medium";
        }

        receive({ widthClass, posture: "flat", hinge: null });
      };

      medium.addEventListener("change", measure);
      expanded.addEventListener("change", measure);
      measure();

      return () => {
        medium.removeEventListener("change", measure);
        expanded.removeEventListener("change", measure);
      };
    });
  });

export const watchWindowLayout = (receive: (layout: WindowLayout) => void) =>
  Effect.acquireRelease(subscribeWindowLayout(receive), (remove) =>
    Effect.sync(remove)
  );
