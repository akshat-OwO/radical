import type { NativeContext } from "./native-context.ts";

/** Default presentation context for documents without native shell data. */
export const browserContext = (): NativeContext => ({
  platform: "browser",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  shellVersion: null,
});
