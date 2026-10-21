import {
  ClientOnly,
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import {
  localNativeContext,
  registerOffline,
  safeAreaStyle,
} from "radical/client";
import { RadicalProvider } from "radical/react";
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { config } from "virtual:radical/config";

const readNativeContext = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext
);

const RootDocument = ({ children }: { children: ReactNode }) => {
  const loadedContext = Route.useLoaderData();
  const nativeContext =
    config.mode === "bundled"
      ? Effect.runSync(localNativeContext())
      : loadedContext;
  const rootStyle: CSSProperties & ReturnType<typeof safeAreaStyle> =
    safeAreaStyle(nativeContext);
  useEffect(() => {
    void registerOffline({
      mode: config.mode,
      production: import.meta.env.PROD,
      base: import.meta.env.BASE_URL,
    });
  }, []);
  return (
    <html lang="en" style={rootStyle}>
      <head>
        <HeadContent />
        <style>{`body { margin: 0; background: #dae9f5; } main { display: flex; flex-direction: column; align-items: stretch; min-height: 100dvh; box-sizing: border-box; padding: calc(var(--radical-safe-area-top) + 16px) calc(var(--radical-safe-area-right) + 16px) calc(var(--radical-safe-area-bottom) + 16px) calc(var(--radical-safe-area-left) + 16px); } pre { white-space: pre-wrap; overflow-wrap: anywhere; }`}</style>
      </head>
      <body>
        <RadicalProvider nativeContext={nativeContext}>
          {children}
        </RadicalProvider>
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  loader: async () =>
    config.mode === "bundled"
      ? await Effect.runPromise(localNativeContext())
      : await readNativeContext(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Radical example" },
    ],
  }),
  shellComponent: RootDocument,
  component: () =>
    config.mode === "bundled" ? (
      <ClientOnly>
        <Outlet />
      </ClientOnly>
    ) : (
      <Outlet />
    ),
});
