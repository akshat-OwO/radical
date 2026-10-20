/** Wrap Start's SSR callback after the router has loaded the selected matches. */
export const offlineHandler =
  <
    Router extends {
      readonly stores: {
        readonly matches: {
          readonly get: () => readonly {
            readonly staticData?: {
              readonly radical?: { readonly offline?: boolean };
            };
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
    const eligible =
      context.router.stores.matches.get().at(-1)?.staticData?.radical
        ?.offline === true;
    context.responseHeaders.set("x-radical-offline", eligible ? "1" : "0");
    return handler(context);
  };

export {
  createRadicalMiddleware,
  radicalMiddleware,
  radicalRequestMiddleware,
} from "./tanstack-middleware.ts";
