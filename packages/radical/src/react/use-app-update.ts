import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { appUpdateStore, unknownAppUpdate } from "../core/update/app-update.ts";
import type {
  AppUpdateState,
  AppUpdateStore,
} from "../core/update/app-update.ts";
import { useIntent } from "./use-files.ts";

const AppUpdateContext = createContext<AppUpdateState>(unknownAppUpdate);

/** Supplies request-scoped SSR state without mutating the browser store on the server. */
export const AppUpdateProvider = ({
  initialState,
  children,
}: {
  readonly initialState: AppUpdateState;
  readonly children?: ReactNode;
}) =>
  createElement(AppUpdateContext.Provider, { value: initialState }, children);

export const useAppUpdate = (store: AppUpdateStore = appUpdateStore) => {
  const initial = useContext(AppUpdateContext);

  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => initial
  );

  return state.status === "unknown" ? initial : state;
};

/** Replace this component with any UI driven by useAppUpdate. Mount under RadicalProvider. */
export const AppUpdateScreen = ({
  store = appUpdateStore,
}: {
  readonly store?: AppUpdateStore;
}) => {
  const { storeUrl } = useAppUpdate(store);
  const intent = useIntent();

  return createElement(
    "main",
    {
      style: {
        minHeight: "100dvh",
        display: "grid",
        placeContent: "center",
        padding: 32,
        textAlign: "center",
        boxSizing: "border-box",
      },
    },
    createElement("h1", null, "Update required"),
    createElement(
      "p",
      null,
      "Install the latest version to keep using this app."
    ),
    storeUrl === null
      ? createElement("p", null, "Check the App Store for an update.")
      : createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              intent.openUrl(storeUrl);
            },
          },
          "Open store"
        ),
    intent.error === undefined
      ? null
      : createElement(
          "p",
          { role: "alert" },
          "The store could not be opened. Please open it manually."
        )
  );
};

export const AppUpdateBoundary = ({
  children,
  fallback,
  store = appUpdateStore,
}: {
  readonly children?: ReactNode;
  readonly fallback?: ReactNode;
  readonly store?: AppUpdateStore;
}) =>
  useAppUpdate(store).status === "required"
    ? (fallback ?? createElement(AppUpdateScreen, { store }))
    : children;
