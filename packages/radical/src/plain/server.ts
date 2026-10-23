import { Effect } from "effect";

import { getNativeContext as getContext } from "../entry/server.ts";

export { safeAreaStyle, withBundledRequests } from "../entry/server.ts";

export type { SafeArea } from "../entry/server.ts";

export const getNativeContext = (request: Request) =>
  Effect.runPromise(getContext(request));
