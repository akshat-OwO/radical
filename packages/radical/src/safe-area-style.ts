import type { NativeContext, SafeArea } from "./native-context.ts";

export const zeroSafeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/** Use on the document root during SSR and hydration. Browsers retain env(). */
export const safeAreaStyle = (context: NativeContext) => ({
  "--radical-safe-area-top":
    context.platform === "browser"
      ? "env(safe-area-inset-top, 0px)"
      : `${context.safeArea.top}px`,
  "--radical-safe-area-right":
    context.platform === "browser"
      ? "env(safe-area-inset-right, 0px)"
      : `${context.safeArea.right}px`,
  "--radical-safe-area-bottom":
    context.platform === "browser"
      ? "env(safe-area-inset-bottom, 0px)"
      : `${context.safeArea.bottom}px`,
  "--radical-safe-area-left":
    context.platform === "browser"
      ? "env(safe-area-inset-left, 0px)"
      : `${context.safeArea.left}px`,
});
