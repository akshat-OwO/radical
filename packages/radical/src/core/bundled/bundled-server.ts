import { Effect } from "effect";

import type { AdapterOutputs } from "../adapter/adapter.ts";
import { getNativeContext } from "../context/request-context.ts";
import { APP_UPDATE_HEADER } from "../update/app-update.ts";
import { appUpdateResponse } from "../update/update-server.ts";
import type { AppUpdateOptions } from "../update/update-server.ts";
import { bundledOrigins, RequestFailed } from "./bundled-request.ts";

export const isBundledOrigin = (request: Request) =>
  bundledOrigins.some((origin) => origin === request.headers.get("origin"));

/** Opt in on the API server. Preflights finish before the request handler. */
export const withBundledRequests = (
  handler: (request: Request) => Response | Promise<Response>,
  outputs: Pick<AdapterOutputs, "exposedHeaders"> = {},
  updates?: AppUpdateOptions
) => {
  const exposedHeaders = outputs.exposedHeaders?.join(", ");

  return (request: Request): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const allowed = isBundledOrigin(request);

        if (allowed && request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin":
                request.headers.get("origin") ?? "",
              "access-control-allow-credentials": "true",
              "access-control-allow-methods":
                "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
              "access-control-allow-headers":
                request.headers.get("access-control-request-headers") ?? "",
              vary: "Origin, Access-Control-Request-Headers",
            },
          });
        }

        const nativeContext =
          updates === undefined ? undefined : yield* getNativeContext(request);

        const update =
          updates === undefined
            ? undefined
            : yield* appUpdateResponse(
                request,
                updates,
                allowed,
                nativeContext
              );

        const response =
          update ??
          (yield* Effect.tryPromise({
            try: () => Promise.resolve(handler(request)),
            catch: (cause) => new RequestFailed({ cause }),
          }));

        const headers = new Headers(response.headers);
        // Vary even for denied or absent origins so shared caches cannot mix responses.
        headers.append("vary", "Origin");

        if (updates !== undefined) {
          headers.append("vary", "Cookie, x-radical-context");

          if (nativeContext?.platform !== "browser") {
            headers.set("cache-control", "no-store");
          }
        }

        if (allowed) {
          headers.set(
            "access-control-allow-origin",
            request.headers.get("origin") ?? ""
          );
          headers.set("access-control-allow-credentials", "true");

          if (response.headers.get(APP_UPDATE_HEADER) === "1") {
            headers.append("access-control-expose-headers", APP_UPDATE_HEADER);
          }

          if (exposedHeaders !== undefined && exposedHeaders !== "") {
            headers.append("access-control-expose-headers", exposedHeaders);
          }
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
    );
};
