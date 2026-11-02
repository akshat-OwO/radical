/**
 * Splash geometry shared by native asset generation and the page's redrawn
 * splash, so both draw the same pixels. Browser-safe.
 */

/** The default splash background, behind the Radical logo. */
export const DEFAULT_SPLASH_BACKGROUND = "#ffffff";

/** Side of the square full-screen splash image, in pixels. */
export const SPLASH_SCREEN_SIZE = 2732;

/** Side of the default Radical logo inside the full-screen splash image. */
export const SPLASH_SCREEN_LOGO_SIZE = 768;

/** Side of the square Android splash icon image, in pixels. */
export const SPLASH_ICON_SIZE = 1024;

/** Side of the default logo inside the Android splash icon, its 62.5% safe zone. */
export const SPLASH_ICON_LOGO_SIZE = 640;

/** Android draws a splash icon without an icon background in a 288dp box. */
export const ANDROID_SPLASH_ICON_DP = 288;

/** Kept equal to templates/radical-mark.svg, which native generation renders. */
export const radicalMarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-label="Radical">
  <path d="M50.38 13.62A26 26 0 0 0 13.62 13.62" stroke="#ff5a1f" stroke-width="5" stroke-linecap="round" opacity=".4"/>
  <circle cx="50.38" cy="13.62" r="7" fill="#ff5a1f"/>
  <circle cx="32" cy="32" r="13" fill="#18181b"/>
</svg>
`;

/** What the page needs to redraw the shell's splash. */
export interface SplashAppearance {
  /** URL of the configured splash image. Omitted for the default Radical logo. */
  readonly image?: string;
  readonly backgroundColor: string;
}

/** The splash as CSS: one square image of `size`, centered on `backgroundColor`. */
export interface SplashLayout {
  readonly backgroundColor: string;
  /** A CSS `url()` value. */
  readonly image: string;
  /** A CSS length for the image's width and height. */
  readonly size: string;
}

const cssUrl = (url: string) => `url(${JSON.stringify(url)})`;

const markUrl = cssUrl(
  `data:image/svg+xml,${encodeURIComponent(radicalMarkSvg)}`
);

// iOS fills the screen with the square splash image, as UIKit's aspect fill does.
const iosScreen = "max(100vw, 100vh)";

/**
 * iOS draws the full-screen image with aspect fill. Android 12 and later draw
 * the background color with the icon centered at 288dp; CSS pixels equal dp.
 */
export const splashLayout = (
  splash: SplashAppearance,
  platform: "android" | "ios"
): SplashLayout => {
  const configured = splash.image !== undefined;
  const image = configured ? cssUrl(splash.image) : markUrl;

  if (platform === "ios") {
    return {
      backgroundColor: splash.backgroundColor,
      image,
      size: configured
        ? iosScreen
        : `calc(${iosScreen} * ${SPLASH_SCREEN_LOGO_SIZE} / ${SPLASH_SCREEN_SIZE})`,
    };
  }

  return {
    backgroundColor: splash.backgroundColor,
    image,
    size: `${
      configured
        ? ANDROID_SPLASH_ICON_DP
        : (ANDROID_SPLASH_ICON_DP * SPLASH_ICON_LOGO_SIZE) / SPLASH_ICON_SIZE
    }px`,
  };
};
