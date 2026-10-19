import { Effect } from "effect";

import { getNativeContext } from "./server.ts";

/** Wrap Start's SSR callback after the router has loaded the selected matches. */
export const offlineHandler =
  <
    Router extends {
      readonly stores: {
        readonly matches: {
          readonly get: () => readonly {
            readonly staticData?: { readonly offline?: boolean };
          }[];
        };
      };
    },
    Result,
  >(
    handler: (context: {
      request: Request;
      router: Router;
      responseHeaders: Headers;
    }) => Result
  ) =>
  (context: {
    request: Request;
    router: Router;
    responseHeaders: Headers;
  }): Result => {
    const nativeContext = Effect.runSync(getNativeContext(context.request));
    const eligible =
      nativeContext.platform === "browser" &&
      context.router.stores.matches.get().at(-1)?.staticData?.offline === true;
    context.responseHeaders.set("x-radical-offline", eligible ? "1" : "0");
    return handler(context);
  };
