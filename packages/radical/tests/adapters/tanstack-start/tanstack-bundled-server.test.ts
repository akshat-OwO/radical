import { assert, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { RouterServer } from "@tanstack/react-router/ssr/server";
import { Effect } from "effect";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { withBundledRequests } from "../../../src/adapters/tanstack-start/tanstack-start-server.ts";
import {
  localNativeContext,
  bundledOrigins,
  RequestFailed,
} from "../../../src/core/bundled/bundled-request.ts";
import { safeAreaStyle } from "../../../src/core/context/native-context.ts";

it.effect("preserves Start's bundled CORS headers for both shells", () =>
  Effect.gen(function* () {
    let calls = 0;

    const handler = withBundledRequests(() => {
      calls += 1;

      return new Response(null, {
        status: 202,
        headers: {
          "access-control-expose-headers": "x-existing",
          "x-tss-serialized": "true",
          vary: "Accept-Encoding",
        },
      });
    });

    for (const origin of bundledOrigins) {
      const request = (method: string) =>
        new Request("https://api.example/_serverFn/id", {
          method,
          headers: {
            origin,
            "access-control-request-headers": "x-radical-context,content-type",
          },
        });

      const before = calls;

      const preflight = yield* Effect.tryPromise({
        try: async () => await handler(request("OPTIONS")),
        catch: (cause) => new RequestFailed({ cause }),
      });

      assert.strictEqual(calls, before);
      assert.strictEqual(preflight.status, 204);
      assert.deepStrictEqual(Object.fromEntries(preflight.headers), {
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "x-radical-context,content-type",
        "access-control-allow-methods":
          "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-origin": origin,
        vary: "Origin, Access-Control-Request-Headers",
      });

      const response = yield* Effect.tryPromise({
        try: async () => await handler(request("POST")),
        catch: (cause) => new RequestFailed({ cause }),
      });

      assert.strictEqual(calls, before + 1);
      assert.strictEqual(response.status, 202);
      assert.deepStrictEqual(Object.fromEntries(response.headers), {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": origin,
        "access-control-expose-headers":
          "x-existing, x-tss-serialized, x-tss-raw, x-tss-error",
        "x-tss-serialized": "true",
        vary: "Accept-Encoding, Origin",
      });
    }
  })
);

it.effect(
  "server-renders a bundled document without native context as 200 with browser styles",
  () =>
    Effect.gen(function* () {
      const root = createRootRoute({
        loader: async () => await Effect.runPromise(localNativeContext()),
        shellComponent: ({ children }: { children: ReactNode }): ReactElement =>
          createElement(
            "html",
            {
              style: safeAreaStyle(root.useLoaderData(), "bundled"),
            },
            createElement("body", null, children)
          ),
      });

      const handler = withBundledRequests(
        async (request) =>
          await Effect.runPromise(
            Effect.gen(function* () {
              // Start supplies defaultSsr outside Router's constructor type.
              const startOptions = { defaultSsr: false as const };

              const router = createRouter({
                ...startOptions,
                routeTree: root,
                history: createMemoryHistory({
                  initialEntries: [new URL(request.url).pathname],
                }),
                isServer: true,
              });

              yield* Effect.promise(async () => {
                await router.load();
              });
              // Start still renders the root shell when SSR skips its loader.
              assert.isUndefined(router.state.matches[0]?.loaderData);

              return new Response(
                renderToString(createElement(RouterServer, { router })),
                {
                  headers: { "content-type": "text/html" },
                }
              );
            })
          )
      );

      const response = yield* Effect.tryPromise({
        try: async () => await handler(new Request("https://api.example/")),
        catch: (cause) => new RequestFailed({ cause }),
      });

      assert.strictEqual(response.status, 200);
      const html = yield* Effect.promise(async () => await response.text());

      for (const edge of ["top", "right", "bottom", "left"]) {
        assert.include(
          html,
          `--radical-safe-area-${edge}:env(safe-area-inset-${edge}, 0px)`
        );
      }
    })
);
