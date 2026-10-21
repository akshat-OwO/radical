# 0004: Bundled mode

The shell must be able to start without a UI server. Use TanStack Start's SPA build with Capacitor's asset server, while keeping remote mode's server rendering and offline recovery. Packaged assets reduce reliance on a remote website, but do not guarantee App Store acceptance.

## Config and build

`mode` is Schema-defined as `"remote" | "bundled"` and defaults to remote when omitted. Bundled mode requires an exact HTTP or HTTPS `origin` for server functions and data calls. In remote mode, `origin` selects the UI server; without it, the CLI uses the URL recorded by the dev server. Keep one config object and pass it to both `tanstackStart(tanstackStartOptions(config))` and `radical(config)`. The helper enables Start's SPA output only in bundled mode. The example also selects `defaultSsr: false` and a client-only root outlet for bundled routes through the generated browser-safe config. Its document uses the injected context immediately so React agrees with native safe-area CSS during hydration.

`radical android` and `radical ios`, including `--generate-only`, resolve Vite config in production mode first. Bundled mode runs Vite's application builder, including Start's server build and SPA prerender. Generation copies `dist/client` to the staged Capacitor `www` webDir, promotes `_shell.html` to `index.html`, then runs Capacitor's normal platform creation and asset copy. Missing SPA output fails before replacing the previous shell. The first version uses Start's standard output paths and Vite base `/`; custom client output paths and shell names are outside this contract. A Vite build alone produces the SPA without generating native projects.

Bundled Capacitor config omits `server.url`. Android serves `https://localhost`; iOS serves `capacitor://localhost`. Capacitor provides history fallback to `index.html`. Changing `mode` and regenerating is sufficient to switch the same app between remote and bundled loading. `origin` stays configured in either mode. Shipping a new UI requires a new native build.

## Requests and context

`virtual:radical/config` exposes only `mode` and `origin`. Wire `createRadicalFetch(config)` from `radical/client` to Start's `createStart({ serverFns: { fetch } })`. Use the same fetch helper for application API calls. It redirects requests to local shell URLs to the configured origin, preserves paths, queries, methods, bodies, cancellation, and caller headers, and uses `credentials: "include"`. Absolute requests to that origin also receive native context. Other origins and normal browser or remote-mode fetches keep their existing behavior. Asset loading uses the browser normally. Arbitrary global `fetch` calls and HTML form submissions are not rewritten.

Both shells inject the current native context at document start and refresh it after inset changes. The fetch helper sends URI-encoded JSON in `x-radical-context`. `getNativeContext` reads that header before the remote-mode cookie and validates it with Schema. Invalid context produces browser defaults. Context is untrusted presentation data, never authentication. Local context also lets the example start and navigate without an API call; its explicit server-function button demonstrates remote execution.

The API server must opt in with `withBundledRequests(handler)` from `radical/server` and `createRadicalRequestMiddleware()` from `radical/tanstack-start-server`. The wrapper answers preflights before Start handles them, permits exactly `https://localhost` and `capacitor://localhost`, allows credentials and requested headers, and exposes Start's serialization and raw-response headers. The middleware permits those exact origins through Start's server-function CSRF guard, including cross-site Fetch Metadata, while retaining the existing guard for other callers. The existing `radicalRequestMiddleware` remains the remote-only default. These origins identify a class of local apps, not a particular signed app. Authenticate and authorize every sensitive endpoint independently.

Use HTTPS for production API origins. HTTP origins enable Android cleartext and mixed content and iOS's web-content ATS exception for development. Cross-site cookie sessions depend on `SameSite=None; Secure` and WebView third-party-cookie policy; `credentials: "include"` cannot override blocked cookies. Applications that need reliable bundled authentication must choose a suitable token or platform authentication flow. This change does not promise shared remote-mode sessions.

Do not enable CapacitorHttp. Standard fetch keeps Start's streaming responses, cancellation, serialization, and browser CORS behavior. A native HTTP proxy would require a second transport and cookie policy without solving authentication for us.

## Remote-only behavior

Bundled shells permit top-level navigation only within their local asset origin. API origins and `allowlist` entries do not become bridged remote documents. iOS omits `WKAppBoundDomains` and disables its navigation limit flag. Both shells retain bridge registration, safe-area events, Device, and native snapshot transitions.

Bundled builds omit radical's offline worker output. `registerOffline({ mode })` skips registration in bundled mode. Android bypasses `/.radical/launch` and worker interception; iOS skips snapshot lookup and remote fallback recovery. Packaged UI requires none of these mechanisms. Network data can still fail and belongs to the app's error handling. Remote mode keeps cookies, the exact-origin allowlist, Android's launch gate, iOS App-Bound Domains, offline snapshots, and packaged fallback behavior.

## Sources

- [TanStack Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode), including SPA prerender and server-route separation.
- Installed Start `createStart.ts`, `createCsrfMiddleware.ts`, and `client-rpc/serverFnFetcher.ts` define the custom fetch hook, Fetch Metadata guard precedence, and protocol headers.
- [Capacitor config](https://capacitorjs.com/docs/config) defines the local schemes, webDir, mixed content, and App-Bound Domains settings.
