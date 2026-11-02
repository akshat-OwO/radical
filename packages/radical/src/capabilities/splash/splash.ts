import { Context, Effect, Layer, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import { callPlugin, definePlugin } from "../../core/plugins/plugins.ts";

export type SplashError = BridgeError;

/** Every shell registers this plugin, whatever internal plugins are enabled. */
export const splashPlugin = definePlugin({
  id: "splash",
  bridge: "RadicalSplash",
  dependencies: {},
  commands: {
    // Capacitor resolves an empty call without a payload.
    hide: { args: Schema.Struct({}), result: Schema.Unknown, errors: {} },
  },
});

export class SplashPaint extends Context.Service<
  SplashPaint,
  {
    /** Completes once the page's current frame is on screen. */
    readonly painted: Effect.Effect<void>;
  }
>()("radical/SplashPaint") {}

const frame = Effect.callback<number>((resume) => {
  const handle = requestAnimationFrame((time) => {
    resume(Effect.succeed(time));
  });

  return Effect.sync(() => {
    cancelAnimationFrame(handle);
  });
});

/** Marks the images `<Splash />` draws, so hiding waits until they decode. */
export const splashImageAttribute = "data-radical-splash-image";

// An image that never decodes is drawn as nothing; the frame wait still runs.
const imagesDecoded = Effect.suspend(() =>
  Effect.forEach(
    document.querySelectorAll<HTMLImageElement>(`img[${splashImageAttribute}]`),
    (image) => Effect.tryPromise(() => image.decode()).pipe(Effect.ignore),
    { concurrency: "unbounded", discard: true }
  )
);

// Decoding finishes first. Then the first frame callback runs before the next
// paint, and the second runs after it.
export const SplashPaintLive = Layer.succeed(SplashPaint, {
  painted: imagesDecoded.pipe(
    Effect.andThen(frame),
    Effect.andThen(frame),
    Effect.asVoid
  ),
});

/**
 * Hides the shell's splash once the page has painted under it. Browsers and
 * shells without the splash command have nothing to hide.
 */
export const hideSplash: Effect.Effect<
  void,
  SplashError,
  Bridge | SplashPaint
> = Effect.gen(function* () {
  const bridge = yield* Bridge;

  if ((yield* bridge.runtime) === "browser") {
    return;
  }

  yield* (yield* SplashPaint).painted;
  yield* callPlugin(
    splashPlugin.bridge,
    "hide",
    splashPlugin.commands.hide,
    {}
  ).pipe(Effect.catchTag("BridgeUnavailable", () => Effect.void));
});

export const splashLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | SplashPaint>
) => effect.pipe(Effect.provide(SplashPaintLive));
