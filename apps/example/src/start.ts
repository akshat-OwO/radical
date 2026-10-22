import { createRadicalFetch } from "@akshatowo/radical/client";
import { createRadicalRequestMiddleware } from "@akshatowo/radical/tanstack-start-server";
import { createStart } from "@tanstack/react-start";
import { config } from "virtual:radical/config";

export const startInstance = createStart(() => ({
  defaultSsr: config.mode !== "bundled",
  requestMiddleware: [...createRadicalRequestMiddleware()],
  serverFns: { fetch: createRadicalFetch(config) },
}));

declare module "@tanstack/react-start" {
  interface Register {
    config: Awaited<ReturnType<typeof startInstance.getOptions>>;
  }
}
