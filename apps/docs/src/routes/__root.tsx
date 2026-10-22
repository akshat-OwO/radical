import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import "../styles.css";

const Root = () => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body className="flex min-h-screen flex-col">
      <RootProvider>
        <Outlet />
      </RootProvider>
      <Scripts />
    </body>
  </html>
);
export const Route = createRootRoute({
  component: Root,
  head: () => ({
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Radical documentation" },
    ],
  }),
  notFoundComponent: () => (
    <main>
      <h1>Page not found</h1>
      <a href="/docs">Read the Radical documentation</a>
    </main>
  ),
});
