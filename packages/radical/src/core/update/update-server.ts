import { Effect, Schema } from "effect";

import type { RadicalConfig } from "../../vite/config.ts";
import type { NativeContext } from "../context/native-context.ts";
import { getNativeContext } from "../context/request-context.ts";
import {
  AppUpdatePolicySchema,
  APP_UPDATE_HEADER,
  APP_UPDATE_PATH,
  resolveAppUpdate,
} from "./app-update.ts";
import type { AppUpdatePolicy, AppUpdateState } from "./app-update.ts";

export interface AppUpdateOptions {
  /** A document route that owns the remote update UI. API requests to it remain gated. */
  readonly updatePath?: string;
  readonly minimumBuild?: AppUpdatePolicy;
  readonly config: RadicalConfig;
  /** Remote document replacement. Never called for bundled API requests. */
  readonly renderUpdate?: (state: AppUpdateState, request: Request) => Response;
}

/** Runs before app handlers. The policy endpoint always remains reachable. */
export const appUpdateResponse = (
  request: Request,
  options: AppUpdateOptions,
  bundled: boolean,
  nativeContext?: NativeContext
) =>
  Effect.gen(function* () {
    const context = nativeContext ?? (yield* getNativeContext(request));

    const policy = yield* Schema.decodeUnknownEffect(AppUpdatePolicySchema)(
      options.minimumBuild ?? {}
    );

    const state = resolveAppUpdate(context, policy, options.config);

    const { pathname } = new URL(request.url);

    const policyRequest =
      request.method === "GET" && pathname === APP_UPDATE_PATH;

    const document =
      !bundled &&
      request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html") === true;

    const updatePath = options.updatePath ?? "/update";
    const updateRoute = document && updatePath === pathname;

    let result: Response | undefined;

    if (policyRequest || (state.status === "required" && !updateRoute)) {
      let response: Response;

      if (policyRequest || bundled || !document) {
        response = Response.json(state, {
          status: policyRequest ? 200 : 426,
          headers: { [APP_UPDATE_HEADER]: "1" },
        });
      } else if (options.renderUpdate === undefined) {
        response = new Response(null, {
          status: 307,
          headers: { location: updatePath },
        });
      } else {
        response = options.renderUpdate(state, request);
      }

      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      headers.append("vary", "Cookie, x-radical-context");
      headers.set("x-radical-offline", "0");

      result = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return result;
  });

/** Apply to every gated response so shared caches cannot bypass compatibility checks. */
export const appUpdateHeaders = (
  response: Response,
  native: boolean
): Response => {
  const headers = new Headers(response.headers);
  headers.append("vary", "Cookie, x-radical-context");

  if (native) {
    headers.set("cache-control", "no-store");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
