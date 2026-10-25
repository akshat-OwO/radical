import { Effect } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useCallback,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { InvalidSection } from "../capabilities/sections/sections.ts";
import type {
  SectionBadge,
  SectionsController,
  SectionsSnapshot,
} from "../capabilities/sections/sections.ts";

const empty: SectionsSnapshot = { sections: [], active: null, hidden: true };
export const SectionsContext = createContext<SectionsController | null>(null);

export const SectionsProvider = ({
  controller,
  children,
}: {
  readonly controller: SectionsController;
  readonly children?: ReactNode;
}) => createElement(SectionsContext.Provider, { value: controller }, children);

const subscribeEmpty = () => () => {
  /* No configured sections. */
};

const unconfigured = () =>
  Effect.fail(new InvalidSection({ message: "No sections configured" }));

const snapshotEmpty = () => empty;

export const useSectionsEffect = () => {
  const controller = useContext(SectionsContext);

  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? subscribeEmpty,
    controller?.snapshot ?? snapshotEmpty,
    controller?.snapshot ?? snapshotEmpty
  );

  return {
    ...snapshot,
    select: controller?.select ?? unconfigured,
    setBadge: controller?.setBadge ?? unconfigured,
  };
};

export const useSections = () => {
  const {
    select: selectEffect,
    setBadge: setBadgeEffect,
    ...state
  } = useSectionsEffect();

  const select = useCallback(
    (id: string) => Effect.runPromise(selectEffect(id)),
    [selectEffect]
  );

  const setBadge = useCallback(
    (id: string, value: SectionBadge) =>
      Effect.runPromise(setBadgeEffect(id, value)),
    [setBadgeEffect]
  );

  return { ...state, select, setBadge };
};
