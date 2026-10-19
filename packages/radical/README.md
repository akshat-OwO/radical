# radical

Run server-rendered web apps inside native Android and iOS WebView shells.

`radical/vite` validates the core config. `radical/tanstack-start` registers the core plugin and exports the Effect adapter layer. See the [example app](../../apps/example/README.md) for the current setup and the [architecture ADR](../../docs/adr/0001-framework-agnostic-native-shell-plugin.md) for the planned native behavior.

The skeleton accepts `appId`, a dot-separated identifier whose segments start with a letter and contain letters, digits, or underscores, and an optional nonempty `appName`. Validation runs before dev and build start.

The adapter provides empty routes and Start's `dist/client` output. Request context and navigation operations fail with `AdapterUnavailable` until their host framework wiring is implemented.
