import { createStart } from "@tanstack/react-start";
import { radicalRequestMiddleware } from "radical/tanstack-start-server";

export const startInstance = createStart(() => ({
  requestMiddleware: [...radicalRequestMiddleware],
}));

declare module "@tanstack/react-start" {
  interface Register {
    config: Awaited<ReturnType<typeof startInstance.getOptions>>;
  }
}
