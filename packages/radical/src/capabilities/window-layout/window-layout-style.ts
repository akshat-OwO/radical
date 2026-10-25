import type { NativeContext } from "../../core/context/native-context.ts";

/** Bundled documents keep stable style props while the shell owns live CSS. */
export const windowLayoutStyle = (
  context?: NativeContext,
  mode: "remote" | "bundled" = "remote"
) => {
  const hinge =
    mode === "remote" && context?.platform !== "browser"
      ? context?.windowLayout.hinge
      : null;

  return {
    "--radical-hinge-x": `${hinge?.x ?? 0}px`,
    "--radical-hinge-y": `${hinge?.y ?? 0}px`,
    "--radical-hinge-width": `${hinge?.width ?? 0}px`,
    "--radical-hinge-height": `${hinge?.height ?? 0}px`,
  };
};
