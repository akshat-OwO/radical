import { Effect, Schema } from "effect";

import { Bridge } from "./bridge.ts";
import { SafeAreaSchema } from "./native-context.ts";
import type { SafeArea } from "./native-context.ts";

export { safeAreaStyle, zeroSafeArea } from "./native-context.ts";
export type { SafeArea } from "./native-context.ts";

const decodeSafeArea = Schema.decodeUnknownEffect(SafeAreaSchema);

const cssNumber = (css: string) => Number(css.replace("px", "")) || 0;

/** Scoped subscription: no globals are read until acquisition. */
export const watchSafeArea = (receive: (insets: SafeArea) => void) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) !== "browser") {
      if (bridge.observe) {
        yield* Effect.acquireRelease(
          bridge.observe("radicalSafeArea", (value) => {
            Effect.runSync(
              decodeSafeArea(value).pipe(Effect.map(receive), Effect.ignore)
            );
          }),
          (remove) => Effect.sync(remove)
        );
      }
      return;
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;top:0;left:0;width:0;height:0;border:0;box-sizing:content-box;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)";
        document.body.append(probe);
        const measure = () => {
          const style = getComputedStyle(probe);
          receive({
            top: cssNumber(style.paddingTop),
            right: cssNumber(style.paddingRight),
            bottom: cssNumber(style.paddingBottom),
            left: cssNumber(style.paddingLeft),
          });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(probe, { box: "border-box" });
        window.addEventListener("resize", measure);
        measure();
        return () => {
          observer.disconnect();
          window.removeEventListener("resize", measure);
          probe.remove();
        };
      }),
      (remove) => Effect.sync(remove)
    );
  });

/** Keep shell CSS current after mount. Browser CSS continues to use env(). */
export const syncSafeArea = (receive: (value: SafeArea) => void) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const native = (yield* bridge.runtime) !== "browser";
    yield* watchSafeArea((value) => {
      if (native) {
        for (const [edge, inset] of Object.entries(value)) {
          const name = `--radical-safe-area-${edge}`;
          const css = `${inset}px`;
          const { style } = document.documentElement;
          if (style.getPropertyValue(name) !== css) {
            style.setProperty(name, css);
          }
        }
      }
      receive(value);
    });
  });
