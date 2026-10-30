import { createRadicalFetch } from "@akshatowo/radical/client";
import { createRadicalRequestMiddleware } from "@akshatowo/radical/tanstack-start-server";
import { createIsomorphicFn, createStart } from "@tanstack/react-start";
import { config } from "virtual:radical/config";

import { readUpdatePolicy } from "./update-policy.ts";

const updatePolicy = createIsomorphicFn()
  .server(readUpdatePolicy)
  .client(() => null);

export const startInstance = createStart(() => ({
  defaultSsr: config.mode !== "bundled",
  requestMiddleware: [
    ...createRadicalRequestMiddleware(updatePolicy() ?? undefined),
  ],
  serverFns: { fetch: createRadicalFetch(config) },
}));

declare module "@tanstack/react-start" {
  interface Register {
    config: Awaited<ReturnType<typeof startInstance.getOptions>>;
  }
}
