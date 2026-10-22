import { createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { Effect } from "effect";

import { isBundledOrigin } from "../../core/bundled/bundled-server.ts";
import type { NativeContext } from "../../core/context/native-context.ts";
import { getNativeContext } from "../../entry/server.ts";

/** Connect a native-context reader to Start's request-scoped context. */
export const createRadicalMiddleware = (
  get?: (request: Request) => Effect.Effect<NativeContext>
) =>
  createMiddleware().server(({ request, next }) =>
    // Keep Start's continuation outside the Effect runner so redirects retain identity.
    // oxlint-disable-next-line promise/prefer-await-to-then -- Promise boundary without async library code.
    Effect.runPromise((get ?? getNativeContext)(request)).then(
      (nativeContext) =>
        // oxlint-disable-next-line promise/no-callback-in-promise -- Start owns the continuation.
        next({ context: { nativeContext } })
    )
  );

export const radicalMiddleware = createRadicalMiddleware();

/** Preserve Start's server-function CSRF guard when supplying request middleware. */
export const radicalRequestMiddleware = [
  createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  radicalMiddleware,
] as const;

/** Explicit API-server opt-in. Other cross-site callers retain Start's CSRF guard. */
export const createRadicalRequestMiddleware = () =>
  [
    createCsrfMiddleware({
      filter: (ctx) => ctx.handlerType === "serverFn",
      secFetchSite: (site, ctx) =>
        site === "same-origin" || isBundledOrigin(ctx.request),
      origin: (origin, ctx) =>
        origin === new URL(ctx.request.url).origin ||
        isBundledOrigin(ctx.request),
    }),
    radicalMiddleware,
  ] as const;
