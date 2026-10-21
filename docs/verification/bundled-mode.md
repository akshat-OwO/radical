# Bundled mode verification

Verified on 2026-10-21 using Pixel_9, Android 16, serial `emulator-5554`. The example uses `dev.radical.example.android` and `origin: "http://localhost:4173"`. Screenshots are attached to the implementation PR. No iOS device was booted.

## Packaged Android UI and API requests

Changed only `mode` to `"bundled"` in the example Vite config, then generated and compiled:

```sh
pnpm --filter radical build
pnpm --filter @radical/example exec radical android --generate-only
cd apps/example/.radical/android/android
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew assembleDebug
```

The CLI ran Start's SPA prerender and copied `_shell.html`, JavaScript, and CSS into the native project. The packaged config had no `server.url`, an empty navigation allowlist, and both Device and Transitions enabled. Gradle reported `BUILD SUCCESSFUL`.

Installed the APK and opened it with `agent-device`. The WebView loaded scripts from `https://localhost/assets/`. Device info showed `sdk_gphone64_arm64`, Android `16`, manufacturer `Google`, and `isVirtual: true`. Native safe-area values were top `54.095237731933594` and bottom `24`. The production build had no hydration errors in `Capacitor/Console`.

No UI dev server ran. For the server-function test, a temporary Node HTTP adapter on port 4173 called the built Start handler only for `/_serverFn/` paths. Every other path returned 404. `adb reverse tcp:4173 tcp:4173` connected the emulator to it. A direct request to `/` returned `UI request HTTP 404`.

Tapping **Call server function** produced these API-only server logs:

```text
API ONLY listening on 4173; UI requests return 404
OPTIONS /_serverFn/bb88c49646ee2eaa3324b213681367e73aa58286b256d9c2031272ac69f17bfc 204 origin=https://localhost context=undefined
GET /_serverFn/bb88c49646ee2eaa3324b213681367e73aa58286b256d9c2031272ac69f17bfc 200 origin=https://localhost context=%7B%22platform%22%3A%22android%22%2C%22safeArea%22%3A%7B%22top%22%3A54.095237731933594%2C%22right%22%3A0%2C%22bottom%22%3A24%2C%22left%22%3A0%7D%2C%22shellVersion%22%3A%220.0.0%22%7D
```

The page displayed the decoded Android context returned by the server. This tests CORS preflight, Start serialization headers, routing to the configured origin, and native context delivery without a cross-site context cookie.

Stopped the API server, confirmed port 4173 refused connections, force-stopped the app, and reopened it. The home page and Device info loaded. **Fade to about** navigated successfully with no server running. The initial route no longer waits for an API request.

## Native transitions

Navigated to Details, used Back, then navigated to About after stopping the API. The native bridge logs recorded the overlay protocol:

```text
pluginId: RadicalTransitions, methodName: cover, methodData: {"id":"1"}
pluginId: RadicalTransitions, methodName: reveal, methodData: {"id":"1","kind":"slide","direction":"forward","reducedMotion":false}
pluginId: RadicalTransitions, methodName: remove, methodData: {"id":"1"}
pluginId: RadicalTransitions, methodName: reveal, methodData: {"id":"2","kind":"slide","direction":"back","reducedMotion":false}
pluginId: RadicalTransitions, methodName: reveal, methodData: {"id":"1","kind":"fade","direction":"forward","reducedMotion":false}
```

The details and about accessibility trees contained their expected headings and Home links. Device and transitions use the same manifests as remote mode.

## Remote mode after the config flip

Changed `mode` back to `"remote"`, retaining the same origin and application code:

```sh
pnpm --filter @radical/example build
pnpm --filter @radical/example exec radical android --generate-only
pnpm --filter @radical/example exec vp preview --host 0.0.0.0 --port 4173
```

Recompiled and installed the generated Android project. Its Capacitor config contained `server.url: "http://localhost:4173"`; its `www/index.html` was the placeholder rather than the SPA. Native logs confirmed:

```text
D Capacitor: Loading app at http://localhost:4173
```

The UI loaded, Device info showed Android 16, and **Call server function** returned Android context with the same safe-area values through the remote cookie path. The slide transition also completed with native cover and reveal calls. No request-routing header is added in remote mode. The example config is left in remote mode.

## Generic iOS build

Generated bundled mode with `radical ios --generate-only`, then compiled without booting a simulator:

```sh
cd apps/example/.radical/ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build build
```

Result: `BUILD SUCCEEDED`. The generated project packaged SPA assets, omitted `server.url` and `WKAppBoundDomains`, disabled `limitsNavigationsToAppBoundDomains`, and retained Device and Transitions. iOS runtime behavior and authentication were not exercised.

## Repository checks

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `pnpm run ready`, and `pnpm install --frozen-lockfile` pass. The ready suite runs Ultracite, Vite checks, Effect type checks, and all 192 tests. Tests cover both generated shells and loading modes, config validation, request paths and bodies, native context precedence, credentials, CORS preflights, exposed Start headers, and CSRF origin checks. No lockfile changes or `@pnpm/exe` entries are included.

The API and preview servers were stopped, Gradle reported two daemons stopped, the port forward was removed, and `agent-device close` completed. The agent-device daemon was left running.
