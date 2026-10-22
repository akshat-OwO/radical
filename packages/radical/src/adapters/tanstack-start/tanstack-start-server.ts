import { Effect } from "effect";

import { withBundledRequests as coreBundledRequests } from "../../core/bundled/bundled-server.ts";
import { tanstackOutputs } from "./tanstack-outputs.ts";

/** Expose Start's response protocol to bundled clients. */
export const withBundledRequests = (
  handler: (request: Request) => Response | Promise<Response>
) =>
  Effect.runSync(
    tanstackOutputs.pipe(
      Effect.map((outputs) => coreBundledRequests(handler, outputs))
    )
  );

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
  createRadicalRequestMiddleware,
  createRadicalMiddleware,
  radicalMiddleware,
  radicalRequestMiddleware,
} from "./tanstack-middleware.ts";
