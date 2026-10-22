import { Effect } from "effect";
import { useCallback } from "react";

import {
  clearWebData,
  dataProtectionLive,
  setDataProtection,
} from "../capabilities/data-protection/data-protection.ts";
import type {
  DataProtectionError,
  DataProtectionStatus,
} from "../capabilities/data-protection/data-protection.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import type { ActionState } from "./use-bridge-action.ts";

export interface DataProtectionState extends ActionState<
  DataProtectionStatus | true,
  DataProtectionError
> {
  readonly setEnabled: (enabled: boolean) => void;
  readonly clearWebData: () => void;
}

/** Explicit actions. Protection persists until disabled, including across unmounts. */
export const useDataProtection = (): DataProtectionState => {
  const { run, ...state } = useBridgeAction<
    DataProtectionStatus | true,
    DataProtectionError
  >();

  const setEnabled = useCallback(
    (enabled: boolean) => {
      run(setDataProtection(enabled));
    },
    [run]
  );

  const clear = useCallback(() => {
    run(dataProtectionLive(clearWebData).pipe(Effect.as(true)));
  }, [run]);

  return { ...state, setEnabled, clearWebData: clear };
};
