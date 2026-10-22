import { Effect } from "effect";
import { useCallback } from "react";

import {
  hapticImpact,
  hapticNotification,
  hapticSelection,
  hapticsLive,
} from "./haptics.ts";
import type { HapticError, ImpactStyle } from "./haptics.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import type { ActionState } from "./use-bridge-action.ts";

export interface HapticFeedbackState extends Omit<
  ActionState<true, HapticError>,
  "error"
> {
  readonly impact: (style?: ImpactStyle) => void;
  readonly light: () => void;
  readonly medium: () => void;
  readonly heavy: () => void;
  readonly success: () => void;
  readonly warning: () => void;
  readonly failure: HapticError | undefined;
  readonly error: () => void;
  readonly selection: () => void;
}

/** Stable helpers with one interruptible action per hook. */
export const useHapticFeedback = (): HapticFeedbackState => {
  const {
    run,
    error: failure,
    ...state
  } = useBridgeAction<true, HapticError>();
  const impact = useCallback(
    (style?: ImpactStyle) => {
      run(hapticsLive(hapticImpact(style)).pipe(Effect.as(true)));
    },
    [run]
  );
  const light = useCallback(() => {
    impact("LIGHT");
  }, [impact]);
  const medium = useCallback(() => {
    impact("MEDIUM");
  }, [impact]);
  const heavy = useCallback(() => {
    impact("HEAVY");
  }, [impact]);
  const success = useCallback(() => {
    run(hapticsLive(hapticNotification("SUCCESS")).pipe(Effect.as(true)));
  }, [run]);
  const warning = useCallback(() => {
    run(hapticsLive(hapticNotification("WARNING")).pipe(Effect.as(true)));
  }, [run]);
  const error = useCallback(() => {
    run(hapticsLive(hapticNotification("ERROR")).pipe(Effect.as(true)));
  }, [run]);
  const selection = useCallback(() => {
    run(hapticsLive(hapticSelection).pipe(Effect.as(true)));
  }, [run]);
  return {
    ...state,
    failure,
    impact,
    light,
    medium,
    heavy,
    success,
    warning,
    error,
    selection,
  };
};
