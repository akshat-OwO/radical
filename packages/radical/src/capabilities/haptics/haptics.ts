import { Context, Effect, Layer, Schema } from "effect";

import { Bridge, BridgeDecodeError } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import { hapticsPlugin } from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import {
  HapticFeedbackFailed,
  ImpactStyleSchema,
  NotificationTypeSchema,
} from "./haptics-schema.ts";
import type { ImpactStyle, NotificationType } from "./haptics-schema.ts";

export {
  HapticFeedbackFailed,
  ImpactStyleSchema,
  NotificationTypeSchema,
} from "./haptics-schema.ts";

export type { ImpactStyle, NotificationType } from "./haptics-schema.ts";

export type HapticError = BridgeError | HapticFeedbackFailed;

const supportsVibration = (
  source: Navigator | undefined
): source is Navigator => typeof source?.vibrate === "function";

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
        if (typeof navigator !== "undefined" && supportsVibration(navigator)) {
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
    const decodedStyle = yield* Schema.decodeEffect(ImpactStyleSchema)(
      style
    ).pipe(
      Effect.mapError(
        (cause) =>
          new BridgeDecodeError({
            plugin: hapticsPlugin.bridge,
            method: "impact",
            cause,
          })
      )
    );

    const bridge = yield* Bridge;

    if ((yield* bridge.runtime) === "browser") {
      const browser = yield* BrowserHaptics;

      return yield* browser.vibrate([
        { LIGHT: 10, MEDIUM: 20, HEAVY: 30 }[decodedStyle],
      ]);
    }

    return yield* callPlugin(hapticsPlugin.bridge, "impact", native.impact, {
      style: decodedStyle,
    }).pipe(Effect.asVoid);
  });

export const hapticNotification = (type: NotificationType) =>
  Effect.gen(function* () {
    const decodedType = yield* Schema.decodeEffect(NotificationTypeSchema)(
      type
    ).pipe(
      Effect.mapError(
        (cause) =>
          new BridgeDecodeError({
            plugin: hapticsPlugin.bridge,
            method: "notification",
            cause,
          })
      )
    );

    const bridge = yield* Bridge;

    if ((yield* bridge.runtime) === "browser") {
      const browser = yield* BrowserHaptics;

      const patterns = {
        SUCCESS: [10, 50, 10],
        WARNING: [30, 50, 30],
        ERROR: [50, 50, 50, 50, 50],
      };

      return yield* browser.vibrate(patterns[decodedType]);
    }

    return yield* callPlugin(
      hapticsPlugin.bridge,
      "notification",
      native.notification,
      { type: decodedType }
    ).pipe(Effect.asVoid);
  });

/** One discrete selection, including iOS generator preparation and release. */
export const hapticSelection = Effect.gen(function* () {
  const bridge = yield* Bridge;

  if ((yield* bridge.runtime) === "browser") {
    const browser = yield* BrowserHaptics;

    return yield* browser.vibrate([10]);
  }

  return yield* callSelection("selectionStart").pipe(
    Effect.andThen(callSelection("selectionChanged")),
    // Release the native generator on failure or interruption of either call.
    Effect.ensuring(callSelection("selectionEnd").pipe(Effect.ignore))
  );
});

export const hapticsLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserHaptics>
) => effect.pipe(Effect.provide(BrowserHapticsLive));
