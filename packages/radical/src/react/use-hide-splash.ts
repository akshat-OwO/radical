import { Effect } from "effect";
import { useCallback, useContext, useEffect } from "react";

import { hideSplash, splashLive } from "../capabilities/splash/splash.ts";
import { BridgeContext } from "./use-bridge-effect.ts";

/**
 * Returns a stable function that hides the shell's splash. Pass `ready` to
 * hide it the first time `ready` is true; failures there are ignored because
 * the shell's timeout still ends the splash.
 */
export const useHideSplash = (ready?: boolean): (() => Promise<void>) => {
  const layer = useContext(BridgeContext);

  const hide = useCallback(
    () => Effect.runPromise(splashLive(hideSplash).pipe(Effect.provide(layer))),
    [layer]
  );

  useEffect(() => {
    if (ready === true) {
      Effect.runFork(
        splashLive(hideSplash).pipe(Effect.provide(layer), Effect.ignore)
      );
    }
  }, [ready, layer]);

  return hide;
};
