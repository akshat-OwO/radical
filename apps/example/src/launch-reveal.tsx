import {
  Splash,
  splashLayout,
  useHideSplash,
  useNativeContext,
  useSections,
} from "@akshatowo/radical/react";
import { useEffect, useRef, useState } from "react";
import { config } from "virtual:radical/config";

// The Radical logo as one solid shape, used as the window onto the app.
const hole = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M50.38 13.62A26 26 0 0 0 13.62 13.62" stroke="#000" stroke-width="5" stroke-linecap="round"/><circle cx="50.38" cy="13.62" r="7" fill="#000"/><circle cx="32" cy="32" r="13" fill="#000"/></svg>'
)}")`;

/**
 * Bounces the splash logo, then grows it into a window onto the app. The section
 * bar stays hidden until the reveal ends, then slides in.
 */
export const LaunchReveal = () => {
  const { platform } = useNativeContext();
  const hide = useHideSplash();
  const { setHidden } = useSections();
  const started = useRef(false);
  const mark = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<"splash" | "reveal" | "done">("splash");

  useEffect(() => {
    if (platform === "browser" || started.current) {
      return;
    }

    started.current = true;

    const bounce = async () => {
      // The bar sits above the page, so it would cover the reveal.
      await setHidden(true);
      // <Splash> drew the same frame, so the native splash leaves no seam.
      await hide();
      await mark.current?.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(0.82)", offset: 0.35 },
          { transform: "scale(1.08)", offset: 0.7 },
          { transform: "scale(1)" },
        ],
        { duration: 700, easing: "ease-in-out" }
      ).finished;
    };

    void bounce().then(
      () => {
        setPhase("reveal");
      },
      () => {
        setPhase("done");
      }
    );
  }, [hide, platform, setHidden]);

  useEffect(() => {
    if (phase === "done" && platform !== "browser") {
      void setHidden(false);
    }
  }, [phase, platform, setHidden]);

  useEffect(() => {
    if (phase !== "reveal") {
      return;
    }

    void portal.current
      ?.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(0.9)", offset: 0.2 },
          { transform: "scale(40)" },
        ],
        {
          duration: 1500,
          easing: "cubic-bezier(.55,0,.7,.15)",
          fill: "forwards",
        }
      )
      .finished.finally(() => {
        setPhase("done");
      });
  }, [phase]);

  if (phase === "done" || platform === "browser") {
    return null;
  }

  if (phase === "splash") {
    return <Splash splash={config.splash} markRef={mark} />;
  }

  // In one frame, the logo becomes a logo-shaped window onto the app.
  const { backgroundColor, size } = splashLayout(config.splash, platform);

  return (
    <div
      ref={portal}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2_147_483_647,
        pointerEvents: "none",
        background: backgroundColor,
        maskImage: `${hole}, linear-gradient(#000 0 0)`,
        maskPosition: "center",
        maskSize: `${size} ${size}, 100% 100%`,
        maskRepeat: "no-repeat",
        maskComposite: "exclude",
      }}
    />
  );
};
