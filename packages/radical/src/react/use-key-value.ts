import { Effect } from "effect";
import { useCallback, useEffect, useMemo } from "react";

import { keyValueStore } from "../capabilities/key-value/key-value.ts";
import type {
  KeyValueOptions,
  Lookup,
} from "../capabilities/key-value/key-value.ts";
import { useBridgeAction } from "./use-bridge-action.ts";

/** Read on mount; writes refresh the lookup. Overlapping actions are ignored. */
export const useKeyValue = (options: KeyValueOptions, key: string) => {
  const { store, namespace, backup } = options;

  const handle = useMemo(
    () => keyValueStore({ store, namespace, backup }),
    [store, namespace, backup]
  );

  type Error = Effect.Error<ReturnType<typeof handle.get>>;

  const identity = JSON.stringify([store, namespace, backup, key]);
  const { run, ...state } = useBridgeAction<Lookup<unknown>, Error>(identity);

  const refresh = useCallback(() => {
    run(handle.get(key));
  }, [run, handle, key]);

  useEffect(refresh, [refresh]);

  return {
    ...state,
    refresh,
    set: useCallback(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The store validates the JSON input.
      (value: unknown) => {
        run(handle.set(key, value).pipe(Effect.andThen(handle.get(key))));
      },
      [run, handle, key]
    ),
    remove: useCallback(() => {
      run(handle.remove(key).pipe(Effect.andThen(handle.get(key))));
    }, [run, handle, key]),
    clear: useCallback(() => {
      run(handle.clear().pipe(Effect.andThen(handle.get(key))));
    }, [run, handle, key]),
  };
};
