# radical

Run server-rendered web apps inside native Android and iOS WebView shells.

`radical/vite` validates the core config. `radical/tanstack-start` registers the core plugin and exports the Effect adapter layer. See the [example app](../../apps/example/README.md) for setup and the [architecture ADR](../../docs/adr/0001-framework-agnostic-native-shell-plugin.md) for the planned native behavior.

The config accepts `appId`, a dot-separated identifier whose segments start with a letter and contain letters, digits, or underscores, and an optional nonempty `appName`. Validation runs before dev and build start.

## Native context

`getNativeContext(request)` from `radical/server` returns an Effect containing the platform, safe-area insets, and shell version. Requests without a valid shell cookie receive browser context.

The [cookie contract](src/native-context.ts) is documented alongside its schemas in one module, exported as `radical/native-context`. The server and shell generators share that module.

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

## Browser offline routes

Declare `staticData: { radical: { offline: true } }` on offline routes. `radical/tanstack-start` augments TanStack Router's `StaticDataRouteOption`, so the option is typed.

In `src/server.ts`, wrap Start's SSR callback so the selected route marks eligible HTML responses:

```ts
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { offlineHandler } from "radical/tanstack-start-server";

export default {
  fetch: createStartHandler(offlineHandler(defaultStreamHandler)),
};
```

`offlineHandler` reads the final loaded match's `staticData.radical.offline` and sets `x-radical-offline`. It decodes native context on the server and never marks shell documents as eligible. TanStack owns all route selection, including static precedence, optional parameters, and decorated parameters. Parent opt-in does not implicitly opt in a child. `TanStackStartAdapter` remains a Layer; routes remain empty and navigation reports `AdapterUnavailable`.

The plugin writes `radical-manifest.json` and bundles a small standalone `radical-sw.js` into the client output. The manifest contains the client assets, fallback URL, cache prefix, and a build id derived from the worker, asset contents, and fallback contents. Identical builds preserve caches. Provide a standalone fallback document at `public/offline.html`.

Call `registerOffline({ production: import.meta.env.PROD, shell, base: import.meta.env.BASE_URL })` from `radical/client` in a root `useEffect`. It returns a Promise and needs no Effect import in the app. It registers only in production browsers with service worker support. Read `context.nativeContext.platform !== "browser"` in a server function and serialize that boolean through the root route loader as `shell`. Registration skips shells without importing the server decoder into client code. See the example root route. `registerOfflineEffect` exposes the underlying Effect with `ServiceWorkerRegistrationError` for Effect consumers.

The service worker loads documents network first and saves successful HTML carrying `x-radical-offline: 1`. Snapshots use exact URLs, including query strings. It captures an already open offline route on first activation, precaches client assets for hydration, and serves the fallback for offline URLs without a snapshot. A new worker waits for the old worker's clients to close before activation removes previous build caches for the same app and base path.

The worker uses native Promises and Cache Storage without an Effect runtime. Build and registration operations use Effect with typed errors. The same worker policy runs against in-memory services in the unit tests.

## Run an Android shell in remote mode

Install Android SDK platform 36, build tools, an emulator system image, and Java 21. Set `ANDROID_HOME` and `JAVA_HOME` for your installation. The generated project uses its Gradle wrapper.

Install the optional native peers with `pnpm add @capacitor/core@8 @capacitor/android@8` and `pnpm add -D @capacitor/cli@8`.

Start your host framework's dev server, then run `pnpm exec radical android` from the app directory in another terminal. The Vite plugin binds the dev server to the LAN (`0.0.0.0`) so devices can reach it, unless you set `server.host` yourself, and writes `.radical/native.json` with the selected port. Use `devHost` in the radical config to select a reachable LAN address, or `10.0.2.2` for the Android emulator's host alias. The CLI reads that file, regenerates `.radical/android`, and builds and runs the shell. Start an existing AVD first, or select one in Capacitor's target prompt. Use `--target emulator-5554` to select a running emulator, or `--generate-only` to skip building and running.

The server origin is always allowed. Add exact HTTP or HTTPS origins to `allowlist` to permit additional navigation. Origins include their port and have no trailing slash. Other navigation is blocked. Before the first load, the shell sets the native context cookie on every allowed origin with `CookieManager`, so the WebView sends it with every request: navigations, fetch and XHR, form posts, and service-worker requests.

The shell applies system-bar and cutout insets outside the WebView, so the native context reports zero CSS safe-area insets. Native projects and local edits in them are disposable. Templates ship with the package; regeneration replaces the previous project after successful generation. No iOS shell is generated.
