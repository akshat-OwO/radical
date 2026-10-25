import {
  localNativeContext,
  mountNativeContext,
  safeAreaStyle,
} from "@akshatowo/radical/client";
import {
  RadicalProvider,
  useRadicalRuntime,
  useSections,
  useWindowLayout,
} from "@akshatowo/radical/react";
import {
  TanStackSections,
  watchNotificationNavigation,
} from "@akshatowo/radical/tanstack-start-client";
import {
  useRouter,
  ClientOnly,
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { config } from "virtual:radical/config";

const readNativeContext = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext
);

const NotificationNavigation = () => {
  const router = useRouter();
  const runtime = useRadicalRuntime();
  useEffect(() => {
    const stop = watchNotificationNavigation(
      router,
      { appId: config.appId, push: true },
      runtime
    );

    return () => {
      void stop();
    };
  }, [router, runtime]);

  return null;
};

const subscribePlatform = () => () => {
  // The shell platform does not change during this document's lifetime.
};

const SectionNavigation = () => {
  const { sections, active, hidden, select } = useSections();
  const { widthClass } = useWindowLayout();
  const nativeContext = Route.useLoaderData();

  const platform = useSyncExternalStore(
    subscribePlatform,
    () => localNativeContext().platform,
    () => nativeContext.platform
  );

  if (hidden || platform === "ios") {
    return null;
  }

  const rail = widthClass !== "compact";

  return (
    <nav
      aria-label="Sections"
      style={{
        position: "fixed",
        zIndex: 10,
        background: "white",
        display: "flex",
        gap: 8,
        padding: 12,
        paddingBottom: rail
          ? 12
          : "calc(var(--radical-safe-area-bottom) + 12px)",
        ...(rail
          ? {
              left: "var(--radical-safe-area-left)",
              top: "30%",
              width: 80,
              flexDirection: "column",
            }
          : { bottom: 0, left: 0, right: 0, justifyContent: "center" }),
      }}
    >
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          aria-current={active?.id === section.id ? "page" : undefined}
          onClick={() => {
            void select(section.id);
          }}
        >
          {section.title}
          {section.badge === null ? "" : ` (${section.badge})`}
        </button>
      ))}
    </nav>
  );
};

const SectionLayout = ({ children }: { children: ReactNode }) => {
  const router = useRouter();

  return (
    <TanStackSections
      router={router}
      sections={config.navigation?.sections ?? []}
    >
      <SectionNavigation />
      {children}
    </TanStackSections>
  );
};

const RootDocument = ({ children }: { children: ReactNode }) => {
  const nativeContext = Route.useLoaderData();

  const rootStyle: CSSProperties & ReturnType<typeof safeAreaStyle> =
    safeAreaStyle(nativeContext, config.mode);

  useEffect(() => {
    if (config.mode === "bundled") {
      mountNativeContext();
    }
  }, []);

  return (
    <html lang="en" style={rootStyle}>
      <head>
        <HeadContent />
        <style>{`body { margin: 0; background: #dae9f5; } main { display: flex; flex-direction: column; align-items: stretch; min-height: 100dvh; box-sizing: border-box; padding: calc(var(--radical-safe-area-top) + 16px) calc(var(--radical-safe-area-right) + 16px) calc(var(--radical-safe-area-bottom) + 72px) calc(var(--radical-safe-area-left) + 16px); } @media (min-width: 600px) { main { padding-left: calc(var(--radical-safe-area-left) + 120px); } } pre { white-space: pre-wrap; overflow-wrap: anywhere; }`}</style>
      </head>
      <body>
        <RadicalProvider nativeContext={nativeContext}>
          <NotificationNavigation />
          <SectionLayout>{children}</SectionLayout>
        </RadicalProvider>
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  loader: async () =>
    config.mode === "bundled"
      ? localNativeContext()
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
