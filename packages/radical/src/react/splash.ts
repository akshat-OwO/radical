import { createElement, useContext } from "react";
import type { CSSProperties, ReactElement, ReactNode, Ref } from "react";

import { splashLayout } from "../capabilities/splash/splash-layout.ts";
import type { SplashAppearance } from "../capabilities/splash/splash-layout.ts";
import { NativeContextContext } from "./use-bridge-effect.ts";

export interface SplashProps {
  /** `config.splash` from `virtual:radical/config`. */
  readonly splash: SplashAppearance;
  /** The centered splash image, for animating it. */
  readonly markRef?: Ref<HTMLDivElement>;
  /** Merged into the full-screen frame's style. */
  readonly style?: CSSProperties;
  /** Drawn above the splash image. */
  readonly children?: ReactNode;
}

/**
 * Redraws the shell's splash over the page, pixel for pixel, so the page can
 * take over from it after `hideSplash()`. Renders nothing in a browser. The
 * platform comes from the provider's native context, so pass `nativeContext`
 * to `RadicalProvider` for the server render to include it.
 */
export const Splash = ({
  splash,
  markRef,
  style,
  children,
}: SplashProps): ReactElement | null => {
  const { platform } = useContext(NativeContextContext);

  if (platform === "browser") {
    return null;
  }

  const layout = splashLayout(splash, platform);

  return createElement(
    "div",
    {
      "aria-hidden": true,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 2_147_483_647,
        pointerEvents: "none",
        background: layout.backgroundColor,
        ...style,
      },
    },
    createElement("div", {
      ref: markRef,
      style: {
        position: "absolute",
        left: "50%",
        top: "50%",
        width: layout.size,
        height: layout.size,
        translate: "-50% -50%",
        backgroundImage: layout.image,
        backgroundSize: "100% 100%",
      },
    }),
    children
  );
};
