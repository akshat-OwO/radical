import type { Transition } from "../../capabilities/transitions/browser-transitions.ts";

/** Route options shared by offline snapshots and transitions. */
export interface RadicalRouteOptions {
  readonly offline?: boolean;
  readonly transition?: Transition["kind"];
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    radical?: RadicalRouteOptions;
  }
}
