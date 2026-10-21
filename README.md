# radical

A Vite plugin and runtime that runs server-rendered web apps inside native Android and iOS WebView shells. See [docs/adr/0001-framework-agnostic-native-shell-plugin.md](docs/adr/0001-framework-agnostic-native-shell-plugin.md) for the architecture.

## Development

```bash
vp install
vp run ready   # ultracite check, vp check, tests, build
pnpm fix       # ultracite fix
```

## Bundled UI with a remote API

Keep one config object in `vite.config.ts`:

```ts
const config = {
  appId: "dev.example.app",
  mode: "bundled",
  origin: "https://api.example.com",
} satisfies RadicalConfig;

// Imports from radical/tanstack-start; RadicalConfig from radical/vite.
plugins: [tanstackStart(tanstackStartOptions(config)), radical(config)];
```

In `src/start.ts`, import `config` from `virtual:radical/config` and `createRadicalFetch` from `radical/client`:

```ts
export const startInstance = createStart(() => ({
  defaultSsr: config.mode !== "bundled",
  serverFns: { fetch: createRadicalFetch(config) },
  requestMiddleware: [...createRadicalRequestMiddleware()],
}));
```

`createRadicalRequestMiddleware` comes from `radical/tanstack-start-server`. On the API server, wrap the Start handler with `withBundledRequests` from `radical/server` to allow credentialed CORS from the two Capacitor origins. Keep this opt-in on the server when switching modes. Native context travels in a validated header for bundled requests and a cookie for remote requests. It is presentation data, not proof of identity. Use HTTPS and choose authentication that works with WebView cross-site cookie restrictions.

For bundled rendering, wrap the root route's outlet in `ClientOnly`. Use `localNativeContext()` as the stable loader snapshot, `safeAreaStyle(context, config.mode)` for the document, and call `mountNativeContext()` in a mount effect. The library applies native pixels after hydration and keeps later inset updates live. The [example root](apps/example/src/routes/__root.tsx) shows the config-dependent setup.

Run `radical android` or `radical ios` from the app directory. Bundled mode builds Start's SPA, copies its UI assets into both shells' `webDir`, and launches without a UI server. `--generate-only` builds and generates without launching. Use Start's standard `dist/client` output, `_shell.html` name, and Vite base `/`.

Use `createRadicalFetch(config)` for other API calls too. Global fetch and HTML forms retain normal browser behavior. Keep initial route loaders independent of the API if the app must start without it. Call `registerOffline({ mode: config.mode, production: import.meta.env.PROD })` to skip worker registration in bundled mode.

Change `mode` to `"remote"` and regenerate to load the UI from `origin`. Omit `origin` in remote mode to use the running dev server's recorded URL. Bridge plugins, device info, and transitions work in either mode. Bundled mode restricts document navigation to the local asset origin and skips the remote offline worker, launch gate, fallback recovery, and iOS App-Bound Domains. See [ADR 0004](docs/adr/0004-bundled-mode.md) for the request and authentication contract.

## Offline routes in remote shells

Mark a route with `staticData.radical.offline: true` and register the shared worker in production:

```ts
registerOffline({
  production: import.meta.env.PROD,
  base: import.meta.env.BASE_URL,
});
```

`registerOffline` from `radical/client` no longer takes a `platform` option. Browsers, Android, and iOS use the same worker and build-versioned caches. Visit the route online after worker activation to store its exact URL, including the query string.

The generated iOS shell enables App-Bound Domains and persistent website data. The server hostname and allowlist must contain at most ten distinct hostnames. Keep workers on one app origin; the spike observed a ceiling of three worker origins. The shell still enforces the exact-origin navigation allowlist, including ports. Cross-origin subresources and worker fetches remain available.

Online launch opens the configured server URL. If that load fails offline, iOS tries the last visited URL with a confirmed snapshot. Without a snapshot or worker, it shows a packaged offline fallback. Removing all website data removes snapshots and registrations. Uninstalling and reinstalling the app also clears the saved URL. The public `clearWebData` hook is tracked in #24.

Service workers require HTTPS or a trustworthy localhost origin. The iOS simulator shares the host network, so run the production example at `http://localhost:4173` and stop its server to test offline. Plain HTTP LAN addresses do not provide a secure context. See the [iOS verification guide](docs/verification/ios-offline.md) for commands and evidence, and [ADR 0002](docs/adr/0002-ios-offline-caching-with-app-bound-domains.md) for the domain limits.

## Route transitions

Install `browserTransitions(router)` from `radical/tanstack-start-client` once per router and import `radical/transitions.css`. Mark destinations with `staticData.radical.transition: "slide"` or `"fade"`. The same installer selects native snapshot overlays in Android and iOS shells and typed view transitions in browsers. Unsupported browsers and capture failures use plain navigation.

Native overlays cover the full window before the route commits, then reveal only after web and native paint signals. Slides push the new page over the outgoing snapshot with 30% background parallax. Back navigation reverses the push. Overlay timeouts never time out the router commit. Both shells honor reduced motion and expire stale overlays after three seconds. See the [transition reference](packages/radical/docs/transitions.md) and [device verification](docs/verification/native-transitions.md).

## Native plugins

Enable a Schema-defined manifest in Vite config:

```ts
radical({
  appId: "dev.example.app",
  plugins: [{ manifest: "./plugins/echo.ts" }],
  pluginOptions: { Echo: { prefix: "Native: " } },
});
```

A manifest declares its id, Capacitor bridge name, dependencies, native sources, and command argument, result, and error schemas. See the [Echo manifest](apps/example/plugins/echo.ts) and [manifest contract](docs/adr/0003-native-plugin-manifests.md) for the full shape. Native sources resolve relative to the manifest module. Custom plugins are off until listed. Device info and Transitions stay enabled by default; disable either with `internalPlugins: { device: false, transitions: false }`.

Include `.radical/plugins.d.ts` in your app's tsconfig and run `radical typegen` before typechecking. Vite also generates that file at startup. Web code imports typed commands from the virtual module:

```ts
import { Effect } from "effect";
import { BridgeLive } from "radical/client";
import { plugins } from "virtual:radical/plugins";

const echo = plugins.echo.echo({ text: "hello" }).pipe(
  Effect.catchTag("EchoRejected", (error) =>
    Effect.succeed({ text: error.reason })
  ),
  Effect.provide(BridgeLive)
);
```

Native rejection codes map to the command's declared `Schema.TaggedError` classes. Undeclared codes and malformed error data stay `BridgeCallFailed`. Invalid manifests, missing config, undeclared native commands, and dependency conflicts fail generation with typed errors. Disabled plugins contribute no sources, imports, dependencies, or native config. Generate both shells again after changing enabled manifests.
