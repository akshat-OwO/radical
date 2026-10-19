# radical

Run server-rendered web apps inside native Android and iOS WebView shells.

<<<<<<< HEAD `radical/vite` validates the core config. `radical/tanstack-start` registers the core plugin and exports the Effect adapter layer. See the [example app](../../apps/example/README.md) for setup and the [architecture ADR](../../docs/adr/0001-framework-agnostic-native-shell-plugin.md) for the planned native behavior.

The config accepts `appId`, a dot-separated identifier whose segments start with a letter and contain letters, digits, or underscores, and an optional nonempty `appName`. Validation runs before dev and build start.

## Native context

`getNativeContext(request)` from `radical/server` returns an Effect containing the platform, safe-area insets, and shell version. Requests with missing or malformed shell headers receive browser context.

The [header contract](src/native-context.ts) is documented alongside its schemas in one module, exported as `radical/native-context`. The server and shell generators share that module.

For TanStack Start, register `radicalRequestMiddleware` in `src/start.ts`:

```ts
import { createStart } from "@tanstack/react-start";
import { radicalRequestMiddleware } from "radical/tanstack-start";

export const startInstance = createStart(() => ({
  requestMiddleware: [...radicalRequestMiddleware],
}));

declare module "@tanstack/react-start" {
  interface Register {
    config: Awaited<ReturnType<typeof startInstance.getOptions>>;
  }
}
```

The middleware list preserves Start's same-origin CSRF checks for server functions and provides native context for both server functions and SSR.

Server functions read the typed `context.nativeContext`. A route loader can call a server function and expose its result to components through `Route.useLoaderData()`, including during server rendering. See the [example route](../../apps/example/src/routes/index.tsx).

The adapter's `provideRequestContext(get)` creates request middleware with a custom Effect reader. Routes remain empty, outputs remain Start's `dist/client`, and navigation operations still fail with `AdapterUnavailable`.
=======

`radical/vite` validates the core config. `radical/tanstack-start` composes it with browser offline support. Register it next to `tanstackStart()` as in the [example app](../../apps/example/README.md). The config accepts `appId`, a dot-separated identifier whose segments start with a letter and contain letters, digits, or underscores, and an optional nonempty `appName`.

Declare `staticData: { offline: true }` on offline routes. Augment TanStack Router's `StaticDataRouteOption` with `offline?: boolean`, as in the example's router. The adapter reads the initialized route tree, including full paths for nested routes and parameters. `TanStackStartAdapter(routeTree)` supplies these routes through its Effect Layer. Request context and navigation still fail with `AdapterUnavailable`.

The production build evaluates a server-only entry for `getRouter()` from `src/router.tsx`. Pass `{ router: "./path/to/router.tsx" }` as the second argument to `radical()` to change that module. The core writes `radical-manifest.json` and `radical-sw.js` to the client output, with a build id, offline routes, and client assets. Provide a standalone fallback document at `public/offline.html`.

Call `registerOffline({ production: import.meta.env.PROD, base: import.meta.env.BASE_URL })` from `radical/client` in a client Effect. It registers only in production browsers with service worker support. Its isolated shell check uses `Capacitor.isNativePlatform()` until native-context detection is available. Registration failures use `ServiceWorkerRegistrationError`.

The service worker loads documents network first and saves successful HTML for offline routes. Snapshots use exact URLs, including query strings. It captures an already open offline route on first activation, precaches client assets for hydration, and serves the fallback for offline URLs without a snapshot. A new worker waits for the old worker's clients to close before activation removes previous build caches for the same app and base path.

The worker uses native Promises and Cache Storage without an Effect runtime. Build and registration operations use Effect with typed errors. The same worker policy runs against in-memory services in the unit tests.

> > > > > > > d456c20 (Add browser offline routes)
