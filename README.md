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
