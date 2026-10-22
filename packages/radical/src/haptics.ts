import { Context, Effect, Layer } from "effect";

import { Bridge } from "./bridge.ts";
import type { BridgeError } from "./bridge.ts";
import { HapticFeedbackFailed } from "./haptics-schema.ts";
import type { ImpactStyle, NotificationType } from "./haptics-schema.ts";
import { hapticsPlugin } from "./internal-plugins.ts";
import { callPlugin } from "./plugins.ts";

export {
  HapticFeedbackFailed,
  ImpactStyleSchema,
  NotificationTypeSchema,
} from "./haptics-schema.ts";
export type { ImpactStyle, NotificationType } from "./haptics-schema.ts";
export type HapticError = BridgeError | HapticFeedbackFailed;

export class BrowserHaptics extends Context.Service<
  BrowserHaptics,
  {
    readonly vibrate: (
      pattern: readonly number[]
    ) => Effect.Effect<void, HapticFeedbackFailed>;
  }
>()("radical/BrowserHaptics") {}

/** Unsupported or policy-blocked vibration is a successful no-op. */
export const BrowserHapticsLive = Layer.succeed(BrowserHaptics, {
  vibrate: (pattern) =>
    Effect.try({
      try: () => {
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.vibrate === "function"
        ) {
          navigator.vibrate([...pattern]);
        }
      },
      catch: (cause) => new HapticFeedbackFailed({ cause }),
    }),
});

const native = hapticsPlugin.commands;
const callSelection = (
  method: "selectionStart" | "selectionChanged" | "selectionEnd"
) =>
  callPlugin(hapticsPlugin.bridge, method, native[method], {}).pipe(
    Effect.asVoid
  );

/** Defaults to a medium impact. Browser timings approximate strength. */
export const hapticImpact = (style: ImpactStyle = "MEDIUM") =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      const browser = yield* BrowserHaptics;
      return yield* browser.vibrate([
        { LIGHT: 10, MEDIUM: 20, HEAVY: 30 }[style],
      ]);
    }
    return yield* callPlugin(hapticsPlugin.bridge, "impact", native.impact, {
      style,
    }).pipe(Effect.asVoid);
  });

export const hapticNotification = (type: NotificationType) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      const browser = yield* BrowserHaptics;
      const patterns = {
        SUCCESS: [10, 50, 10],
        WARNING: [30, 50, 30],
        ERROR: [50, 50, 50, 50, 50],
      };
      return yield* browser.vibrate(patterns[type]);
    }
    return yield* callPlugin(
      hapticsPlugin.bridge,
      "notification",
      native.notification,
      { type }
    ).pipe(Effect.asVoid);
  });

/** One discrete selection, including iOS generator preparation and release. */
export const hapticSelection = Effect.gen(function* () {
  const bridge = yield* Bridge;
  if ((yield* bridge.runtime) === "browser") {
    const browser = yield* BrowserHaptics;
    return yield* browser.vibrate([10]);
  }
  yield* callSelection("selectionStart");
  return yield* callSelection("selectionChanged").pipe(
    // Release the native generator even on failure or interruption. Cleanup is best effort.
    Effect.ensuring(callSelection("selectionEnd").pipe(Effect.ignore))
  );
});

export const hapticsLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserHaptics>
) => effect.pipe(Effect.provide(BrowserHapticsLive));
