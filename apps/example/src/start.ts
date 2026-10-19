import { createStart } from "@tanstack/react-start";
import { radicalMiddleware } from "radical/tanstack-start";

export const startInstance = createStart(() => ({
  requestMiddleware: [radicalMiddleware],
}));

declare module "@tanstack/react-start" {
  interface Register {
    config: Awaited<ReturnType<typeof startInstance.getOptions>>;
  }
}
