import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { registerOffline } from "radical/client";
import { useEffect } from "react";
import type { ReactNode } from "react";

const RootDocument = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    Effect.runFork(
      registerOffline({
        production: import.meta.env.PROD,
        base: import.meta.env.BASE_URL,
      }).pipe(Effect.ignore)
    );
  }, []);
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
