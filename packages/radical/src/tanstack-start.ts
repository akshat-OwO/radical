import { createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { Effect, Layer } from "effect";
import type { PluginOption } from "vite";

import { AdapterUnavailable } from "./adapter-error.ts";
import { RadicalAdapter } from "./adapter.ts";
import type { RadicalConfig } from "./config.ts";
import type { NativeContext } from "./native-context.ts";
import { getNativeContext } from "./server.ts";
import { radical as corePlugin } from "./vite.ts";

const unavailable = (operation: string) =>
  Effect.fail(new AdapterUnavailable({ operation }));

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

/** Request context is wired; navigation remains unavailable. */
// oxlint-disable-next-line eslint/no-inline-comments -- Bundlers require the purity annotation immediately before the call.
export const TanStackStartAdapter = /* @__PURE__ */ Layer.suspend(() =>
  Layer.succeed(RadicalAdapter, {
    name: "tanstack-start",
    routes: Effect.succeed([]),
    provideRequestContext: (get) =>
      Effect.sync(() => createRadicalMiddleware(get)),
    navigation: Effect.succeed({
      navigate: () => unavailable("navigate"),
      onBeforeNavigate: () => unavailable("onBeforeNavigate"),
      onAfterNavigate: () => unavailable("onAfterNavigate"),
    }),
    outputs: Effect.succeed({ clientDir: "dist/client" }),
  })
);

/** Register next to tanstackStart(); the host framework still owns rendering. */
export const radical = (config: RadicalConfig): PluginOption[] => [
  corePlugin(config),
];
