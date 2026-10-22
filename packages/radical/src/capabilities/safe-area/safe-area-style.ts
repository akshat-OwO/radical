import { browserContext } from "../../core/context/browser-context.ts";
import type {
  NativeContext,
  SafeArea,
} from "../../core/context/native-context.ts";

export const zeroSafeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/** Missing loader data uses browser context, including SSR-disabled document shells.
 * Bundled documents keep identical env() props across prerender, hydration, and live native CSS updates. */
export const safeAreaStyle = (
  context: NativeContext = browserContext(),
  mode: "remote" | "bundled" = "remote"
) => ({
  "--radical-safe-area-top":
    context.platform === "browser" || mode === "bundled"
      ? "env(safe-area-inset-top, 0px)"
      : `${context.safeArea.top}px`,
  "--radical-safe-area-right":
    context.platform === "browser" || mode === "bundled"
      ? "env(safe-area-inset-right, 0px)"
      : `${context.safeArea.right}px`,
  "--radical-safe-area-bottom":
    context.platform === "browser" || mode === "bundled"
      ? "env(safe-area-inset-bottom, 0px)"
      : `${context.safeArea.bottom}px`,
  "--radical-safe-area-left":
    context.platform === "browser" || mode === "bundled"
      ? "env(safe-area-inset-left, 0px)"
      : `${context.safeArea.left}px`,
});
