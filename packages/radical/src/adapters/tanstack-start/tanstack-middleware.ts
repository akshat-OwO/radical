import { createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { Effect } from "effect";

import { isBundledOrigin } from "../../core/bundled/bundled-server.ts";
import type { NativeContext } from "../../core/context/native-context.ts";
import {
  resolveAppUpdate,
  unknownAppUpdate,
} from "../../core/update/app-update.ts";
import {
  appUpdateHeaders,
  appUpdateResponse,
} from "../../core/update/update-server.ts";
import type { AppUpdateOptions } from "../../core/update/update-server.ts";
import { getNativeContext } from "../../entry/server.ts";

/** Connect a native-context reader to Start's request-scoped context. */
export const createRadicalMiddleware = (
  get?: (request: Request) => Effect.Effect<NativeContext>,
  updates?: AppUpdateOptions
) =>
  createMiddleware().server(({ request, next }) =>
    // Keep Start's continuation outside the Effect runner so redirects retain identity.
    // oxlint-disable-next-line promise/prefer-await-to-then -- Promise boundary without async library code.
    Effect.runPromise(
      Effect.gen(function* () {
        const nativeContext = yield* (get ?? getNativeContext)(request);

        const appUpdate =
          updates === undefined
            ? unknownAppUpdate
            : resolveAppUpdate(
                nativeContext,
                updates.minimumBuild ?? {},
                updates.config
              );

        const response =
          updates === undefined
            ? undefined
            : yield* appUpdateResponse(
                request,
                updates,
                isBundledOrigin(request),
                nativeContext
              );

        return { nativeContext, appUpdate, response };
      })
    )
      .then(
        ({ nativeContext, appUpdate, response }) =>
          // oxlint-disable-next-line promise/no-callback-in-promise -- Start owns the continuation.
          response ?? next({ context: { nativeContext, appUpdate } })
      )
      // oxlint-disable-next-line promise/prefer-await-to-then -- Keep framework errors outside the Effect runner.
      .then((result) => {
        if (updates === undefined || result instanceof Response) {
          return result;
        }

        return {
          ...result,
          response: appUpdateHeaders(
            result.response,
            result.context.nativeContext.platform !== "browser"
          ),
        };
      })
  );

export const radicalMiddleware = createRadicalMiddleware();

/** Preserve Start's server-function CSRF guard when supplying request middleware. */
export const radicalRequestMiddleware = [
  createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  radicalMiddleware,
] as const;

/** Explicit API-server opt-in. Other cross-site callers retain Start's CSRF guard. */
export const createRadicalRequestMiddleware = (updates?: AppUpdateOptions) =>
  [
    createCsrfMiddleware({
      filter: (ctx) => ctx.handlerType === "serverFn",
      secFetchSite: (site, ctx) =>
        site === "same-origin" || isBundledOrigin(ctx.request),
      origin: (origin, ctx) =>
        origin === new URL(ctx.request.url).origin ||
        isBundledOrigin(ctx.request),
    }),
    createRadicalMiddleware(undefined, updates),
  ] as const;
