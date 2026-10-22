import { Effect } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import type { SafeArea } from "../../core/context/native-context.ts";

export { safeAreaStyle, zeroSafeArea } from "./safe-area-style.ts";
export type { SafeArea } from "../../core/context/native-context.ts";

// Validate native event data at the DOM boundary without loading schema codecs.
const isInset = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isSafeArea = (value: unknown): value is SafeArea =>
  typeof value === "object" &&
  value !== null &&
  "top" in value &&
  isInset(value.top) &&
  "right" in value &&
  isInset(value.right) &&
  "bottom" in value &&
  isInset(value.bottom) &&
  "left" in value &&
  isInset(value.left);

const cssNumber = (css: string) => Number(css.replace("px", "")) || 0;

/** Lazy subscription acquisition returns its DOM cleanup function. */
export const subscribeSafeArea = (receive: (insets: SafeArea) => void) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) !== "browser") {
      return yield* bridge.observe("radicalSafeArea", (value) => {
        if (isSafeArea(value)) {
          receive(value);
        }
      });
    }
    return yield* Effect.sync(() => {
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
    });
  });

/** Effect callers can tie the same subscription to their scope. */
export const watchSafeArea = (receive: (insets: SafeArea) => void) =>
  Effect.acquireRelease(subscribeSafeArea(receive), (remove) =>
    Effect.sync(remove)
  );
