# radical

A Vite plugin and runtime that runs server-rendered web apps inside native Android and iOS WebView shells. See [docs/adr/0001-framework-agnostic-native-shell-plugin.md](docs/adr/0001-framework-agnostic-native-shell-plugin.md) for the architecture.

## Development

```bash
vp install
vp run ready   # ultracite check, vp check, tests, build
pnpm fix       # ultracite fix
```

## Offline routes in native shells

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
