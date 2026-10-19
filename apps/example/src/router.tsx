import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export const getRouter = () =>
  createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    offline?: boolean;
  }
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
