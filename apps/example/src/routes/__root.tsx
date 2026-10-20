import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { registerOffline, safeAreaStyle } from "radical/client";
import { RadicalProvider, useSafeArea } from "radical/react";
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";

const readNativeContext = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext
);

/** Keep CSS current on routes that do not display the hook's value. */
const SafeAreaContent = ({ children }: { children: ReactNode }): ReactNode => {
  useSafeArea();
  return children;
};

const RootDocument = ({ children }: { children: ReactNode }) => {
  const nativeContext = Route.useLoaderData();
  const rootStyle: CSSProperties & ReturnType<typeof safeAreaStyle> =
    safeAreaStyle(nativeContext);
  const shell = nativeContext.platform !== "browser";
  useEffect(() => {
    void registerOffline({
      production: import.meta.env.PROD,
      shell,
      base: import.meta.env.BASE_URL,
    });
  }, [shell]);
  return (
    <html lang="en" style={rootStyle}>
      <head>
        <HeadContent />
        <style>{`body { margin: 0; background: #dae9f5; } main { min-height: 100dvh; box-sizing: border-box; padding: calc(var(--radical-safe-area-top) + 16px) calc(var(--radical-safe-area-right) + 16px) calc(var(--radical-safe-area-bottom) + 16px) calc(var(--radical-safe-area-left) + 16px); } pre { white-space: pre-wrap; overflow-wrap: anywhere; }`}</style>
      </head>
      <body>
        <RadicalProvider nativeContext={nativeContext}>
          <SafeAreaContent>{children}</SafeAreaContent>
        </RadicalProvider>
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  loader: async () => await readNativeContext(),
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
  component: Outlet,
});
