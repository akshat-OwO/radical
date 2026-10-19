import { createRouter } from "@tanstack/react-router";
import { browserTransitions } from "radical/tanstack-start";

import "radical/transitions.css";

import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const router = createRouter({ routeTree, scrollRestoration: true });
  browserTransitions(router);
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
