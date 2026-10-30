import { Effect } from "effect";

import { createRadicalMiddleware as createEffectMiddleware } from "../adapters/tanstack-start/tanstack-middleware.ts";
import type { NativeContext } from "../core/context/native-context.ts";
import type { AppUpdateOptions } from "../core/update/update-server.ts";

export {
  createRadicalRequestMiddleware,
  radicalMiddleware,
  radicalRequestMiddleware,
} from "../adapters/tanstack-start/tanstack-middleware.ts";

export const createRadicalMiddleware = (
  get?: (request: Request) => NativeContext | Promise<NativeContext>,
  updates?: AppUpdateOptions
) =>
  createEffectMiddleware(
    get
      ? (request) => Effect.promise(() => Promise.resolve(get(request)))
      : undefined,
    updates
  );
