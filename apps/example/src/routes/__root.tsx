import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { registerOffline } from "radical/client";
import { useEffect } from "react";
import type { ReactNode } from "react";

const readShell = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext.platform !== "browser"
);

const RootDocument = ({ children }: { children: ReactNode }) => {
  const shell = Route.useLoaderData();
  useEffect(() => {
    void registerOffline({
      production: import.meta.env.PROD,
      shell,
      base: import.meta.env.BASE_URL,
    });
  }, [shell]);
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  loader: async () => await readShell(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Radical example" },
    ],
  }),
  shellComponent: RootDocument,
  component: Outlet,
});
