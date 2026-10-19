# 0001: Framework-agnostic native shell plugin

- Status: accepted
- Date: 2026-10-19

## Context

An existing framework bundles server rendering, routing, data loading, WebView shells, and a native bridge into one product. Two of its features justify building something: running the web UI inside native Android and iOS WebView shells, and the native capabilities exposed to that UI. Everything else is already covered by mature meta-frameworks.

We want those two features as a Vite plugin and runtime that extend an existing framework, starting with TanStack Start, without forking it and without tying the core to it.

## Decision

Ship one npm package, `radical`, with subpath entry points. The core depends only on web standards (`Request`, URLs, the DOM, Vite build output). Framework-specific code lives behind a small adapter interface.

### Entry points

| Import | Framework-specific | Contents |
| --- | --- | --- |
| `radical/vite` | No | Core Vite plugin: config, manifests, service worker, dev server |
| `radical/client` | No | JS-to-native bridge, runtime detection, transitions engine, service worker registration, safe-area CSS variables |
| `radical/server` | No | `getNativeContext(request: Request)`: native detection, platform, and safe-area from a shell-set cookie |
| `radical/react` | React only, no router | Hooks: `useCamera`, `useSafeArea`, `useDeviceInfo`, `useNetworkStatus`, `useHapticFeedback`, and so on |
| `radical/tanstack-start` | Yes | TanStack Start adapter: Vite plugin wrapper, request middleware, router integration |
| `radical` (bin) | No | CLI that generates, builds, and runs the native projects |

Meta-framework adapters (`radical/tanstack-start`, later `radical/react-router`, `radical/sveltekit`) and UI-library hook entry points (`radical/react`, later `radical/solid`) are separate axes. Native shells never import framework code; they read the generated manifest.

### What the core does

Build and dev time (`radical/vite`):

1. Loads and validates config: app id and name, icons, splash, URL allowlist, `cachePattern`, dev host, enabled native plugins, and mode (remote origin or bundled).
2. Emits `radical-manifest.json`: build id, offline routes, transition rules, asset cache patterns, and allowlist. The service worker and both native shells read it.
3. Generates the service worker, with a cache namespace per build id and a precache list from Vite's client manifest.
4. Provides virtual modules: `virtual:radical/config` (browser-safe config only) and `virtual:radical/plugins` (typed command stubs for enabled native plugins).
5. In dev, binds to the LAN address and prints a URL and QR code for a device or emulator.
6. Writes `.radical/native.json` for the CLI.

Runtime (`radical/client`, `radical/server`): bridge calls with browser fallbacks, the transitions engine (native snapshot overlay in shells, View Transitions or a CSS overlay in browsers, plain navigation on failure), a network-first service worker with an offline fallback page, and request-time native context.

CLI (`radical ios|android`): generates the native projects into a gitignored `.radical/` from templates (as in Expo's continuous native generation), applies plugin manifests, icons, and splash, then builds or runs.

Out of scope: routing, SSR, data fetching, `<head>` metadata, the HTTP server, and authentication. The host framework owns those.

### Adapter interface

```ts
export interface RadicalAdapter {
  name: string;
  /** Vite plugins to compose with the framework's own. */
  vite?(core: RadicalCore): PluginOption[];
  /** Routes and their radical options, for the offline and transition manifest. */
  routes(): RadicalRoute[] | Promise<RadicalRoute[]>; // { pattern, offline?, transition? }
  /** Make NativeContext available during SSR. */
  provideRequestContext(get: (req: Request) => NativeContext): unknown;
  /** Client navigation hooks for transitions and notification deep links. */
  navigation(): {
    navigate(to: string, opts?: { replace?: boolean }): Promise<void>;
    onBeforeNavigate(
      cb: (from: string, to: string) => void | Promise<void>
    ): () => void;
    onAfterNavigate(cb: (to: string) => void): () => void;
  };
  /** Build output locations: client dir, and the SPA shell in bundled mode. */
  outputs(): { clientDir: string; spaShell?: string };
}
```

The interface is a sketch. Implementation in this repo uses Effect, so the final shape will return `Effect` values and use `Layer` for adapter wiring.

### TanStack Start adapter

```ts
// vite.config.ts
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { radical } from "radical/tanstack-start";

export default defineConfig({
  plugins: [tanstackStart(), radical({ appId: "dev.radical.app" })],
});
```

- `routes()`: reads `staticData.radical` (`{ offline: true, transition: "slide" }`) from the router's route tree, and augments `StaticDataRouteOption` so the options are typed. The router generator's plugins do not receive `staticData` values, so the manifest is built from the runtime route tree, not by parsing route files.
- `provideRequestContext`: exports `radicalMiddleware` for `createStart({ requestMiddleware })`, typed through `Register` augmentation.
- `navigation()`: wraps `router.navigate` and `router.subscribe("onBeforeNavigate" | "onResolved")`, and uses the router's `viewTransition` option (`types` for slide or fade) in browsers.
- `outputs()`: Start's `dist/client`, and the `spa.enabled` shell for bundled mode.
- Exports `<RadicalScripts />` for the root route, since Start renders its own document.

Start's `prerender` and `postServerBuild` hooks are internal, so the adapter uses standard Vite `buildApp`, `writeBundle`, and Environment API hooks, and pins the Start version.

### Native layer

Build on Capacitor 8 (MIT) for the bridge, the official plugins (Camera, Haptics, Push Notifications, Network, Device, Filesystem, Preferences, System Bars), and SPM-based iOS projects. Use `@capacitor/assets` for icons and splash.

Capacitor does not fit two of our needs, so we replace them:

- It treats `server.url` as a live-reload feature, not a production mode. Remote-origin loading needs our own native code.
- It expects committed `ios/` and `android/` directories. We generate them into `.radical/`.

Shells deliver native context as a cookie, set natively on each allowed origin before the first load (Android `CookieManager`, iOS `WKHTTPCookieStore`). A WebView cannot add a request header to every request: fetch, XHR, form posts, and service-worker requests bypass native header injection. The WebView sends its cookies with all of them. [ADR 0002](0002-ios-offline-caching-with-app-bound-domains.md) verified that `WKHTTPCookieStore.setCookie` works in the iOS shell.

Custom native plugins: live video stream with viewfinder cut-out, data protection, `clearWebData`, offline cache control, and the snapshot transition overlay.

## Feature coverage

| Area | Provided by |
| --- | --- |
| SSR, streaming, hydration, nested routes, params | TanStack Start and Router |
| Route data fetching, refetch, invalidation | Router `loader`, `router.invalidate()`, or TanStack Query |
| Code splitting, per-component SSR, Suspense | Start code splitting, selective SSR, `React.lazy` |
| Metadata, canonical, Open Graph | Route `head()` |
| Middleware, startup hooks, telemetry | Start request middleware and custom `server.ts` |
| Slide and fade transitions | Router `viewTransition` plus native snapshot overlay (radical) |
| Offline routes, snapshots, service worker | Route `staticData`, generated manifest, service worker (radical) |
| Native request context, safe-area | Start middleware reading a shell-set cookie (radical) |
| Camera, haptics, push, network, device, files | Capacitor plugins wrapped in hooks (`radical/react`) |
| Video stream, data protection, web data clearing | Custom Capacitor plugins (radical native) |
| Native project generation, icons, splash, allowlist | `radical` CLI and `@capacitor/assets` |
| Profiler, AI, MCP tooling | Later, as separate entry points |

## Alternatives considered

- **Tauri v2 mobile.** Requires Rust; remote-URL behaviour on mobile is undocumented.
- **Expo DOM components.** No SSR; Expo recommends `react-native-webview` for remote sites.
- **Ionic Portals.** Commercial license.
- **Hotwire Native.** Rails-oriented, hand-maintained native projects. Its server-served path configuration is worth borrowing for transition and presentation rules.
- **Separate scoped packages (`@radical/*`).** Rejected for user simplicity. Capacitor becomes an optional peer dependency so web-only installs stay light.

## Open questions

- **iOS offline caching.** Resolved in [ADR 0002](0002-ios-offline-caching-with-app-bound-domains.md): use a service worker via App-Bound Domains for remote mode. The simulator spike verified offline HTML and the required WebView APIs; physical-device validation remains open.
- **App Store guideline 4.2.** Apps that only wrap a website risk rejection. Bundled mode (Start `spa.enabled`) reduces the risk.
- Whether `serverFns.base` can point at an absolute remote origin in bundled mode.

## Sources

- TanStack Start middleware: https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/middleware.md
- TanStack Start server entry: https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/server-entry-point.md
- TanStack Start selective SSR: https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/selective-ssr.md
- TanStack Start SPA mode: https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/spa-mode.md
- TanStack Router static route data: https://github.com/TanStack/router/blob/main/docs/router/guide/static-route-data.md
- Start with Capacitor example: https://github.com/daveycodez/tanstack-start-hybrid
- Capacitor config: https://capacitorjs.com/docs/config
- Capacitor 8: https://ionic.io/blog/announcing-capacitor-8
- Hotwire Native path configuration: https://native.hotwired.dev/reference/path-configuration
- Expo continuous native generation: https://docs.expo.dev/workflow/continuous-native-generation
- Expo DOM components: https://docs.expo.dev/guides/dom-components/
