# Bundled mode verification

Verified on 2026-10-21 using Pixel_9, Android 16, serial `emulator-5554`. The example uses `dev.radical.example.android` and `origin: "http://localhost:4173"`. Screenshots are attached to the implementation PR. A follow-up runtime round on the already-booted iPhone Duo is recorded below.

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

Result: `BUILD SUCCEEDED`. The generated project packaged SPA assets, omitted `server.url` and `WKAppBoundDomains`, disabled `limitsNavigationsToAppBoundDomains`, and retained Device and Transitions. This initial check covered compilation only; the follow-up below covers iOS runtime behavior.

## iPhone Duo runtime and hydration revision

Verified the generated app `dev.radical.example.ios` on the already-booted iPhone Duo, iOS 27.1, UDID `88BEE7A3-757E-40C4-A789-5E3259B6B673`. No other device was booted. For this round, the temporary config used `origin: "http://127.0.0.1:4173"`; the simulator reaches the host directly. The tracked config is restored to remote mode and its original localhost origin.

Generated bundled mode, built for this simulator with xcodebuild, and installed and drove it with agent-device. The API-only Node adapter accepted only `/_serverFn/` paths and returned 404 for UI paths. No UI server ran during these checks. The packaged app loaded, Device returned `iPhone19,4`, `ios`, `27.1`, `Apple`, and `isVirtual: true`, and slide, reversed back, and fade animations completed. The PR includes a recording of those transitions on the Duo's active display. After stopping the API and confirming connection refusal, a process restart still opened the packaged home page with Device info.

### Actual custom-scheme Origin and credentials

WebKit sent the literal **`Origin: capacitor://localhost` on both OPTIONS and GET**. It did not send `Origin: null`. JavaScript URL origin serialization for this non-special scheme is not the value WebKit used in these HTTP CORS requests. The existing exact-origin CORS and CSRF rules passed; no null-origin exception was added.

The clean build after the hydration fix produced this server trace, abbreviated only by replacing the server-function id:

```text
OPTIONS /_serverFn/<id> 204
  Origin: capacitor://localhost
  Access-Control-Request-Headers: x-radical-context,x-tsr-serverfn
  Cookie: absent
  Access-Control-Allow-Origin: capacitor://localhost
  Access-Control-Allow-Credentials: true
GET /_serverFn/<id> 200
  Origin: capacitor://localhost
  Cookie: absent
  x-radical-context: URI-encoded JSON with platform ios, right 84, bottom 34, shellVersion 0.0.0
  Access-Control-Allow-Origin: capacitor://localhost
  Access-Control-Allow-Credentials: true
  Access-Control-Expose-Headers: x-tss-serialized, x-tss-raw, x-tss-error
```

The page displayed the decoded iOS context returned by the server. A negative control removed `Access-Control-Allow-Credentials` only in the temporary server adapter. WebKit then stopped at the OPTIONS response, issued no GET, and the page showed **Server unavailable**. Restoring the header restored the successful GET. This establishes that the native request uses credentialed browser CORS rather than bypassing it through CapacitorHttp.

The temporary server also offered a `SameSite=None; Secure` cookie. Repeated calls over this HTTP development origin still sent no Cookie header. This does not establish HTTPS cookie-session support. The ADR's warning about cross-site cookie policy remains; the feature does not promise a shared remote-mode session.

Bundled Info.plist had no `WKAppBoundDomains`, and Capacitor config set `limitsNavigationsToAppBoundDomains: false`. The bridge, native Device, transitions, and cross-origin server functions worked with that setting.

### Hydration comparison

The review identified a real split between Node prerender and injected native context. Added failing tests before changing the library:

- `keeps bundled shell styles identical during prerender and first client render`
- `defers bundled inset CSS until mount and keeps later native updates live`

The fix gives `localNativeContext()` a stable browser-default snapshot until mount. `safeAreaStyle(context, "bundled")` retains `env(...)` React props, and `mountNativeContext()` applies injected pixel values after commit. Native document-start scripts record bundled insets before mount and continue applying changes afterward. API requests still read live injected context independently. A third test, `keeps the bundled loader snapshot stable and applies injected insets only at mount`, checks that handoff with an in-memory document.

For device comparison, added temporary, observational instrumentation only to the ignored generated AppDelegate: a document-start React commit hook and console/error forwarding to a native log handler. Compared the generated `_shell.html` style with the first React html fiber's style props and the DOM style before passive effects. All three matched exactly, with native iOS context already present:

```text
first-react-commit:
  href: capacitor://localhost
  native: { platform: ios, safeArea: { top: 0, right: 84, bottom: 34, left: 0 } }
  mounted: false
  top: env(safe-area-inset-top, 0px)
  right: env(safe-area-inset-right, 0px)
  bottom: env(safe-area-inset-bottom, 0px)
  left: env(safe-area-inset-left, 0px)
after-effects:
  mounted: true
  DOM CSS: top 0px; right 84px; bottom 34px; left 0px
```

An assertion against the generated HTML confirmed the equality. The capture reported no `console.error` or window error events, including hydration errors. Later inset updates are covered by the shell-event regression test. Rotation requests on this Duo pose did not change the reported insets, so they are not claimed as a device rotation check.

Regenerated the project to remove all diagnostic instrumentation, rebuilt, and repeated the bundled server-function call successfully. No verification handler, React hook, or native test command is committed.

### Remote mode and worker after switching back

Changed mode back to remote, rebuilt the web app, generated and built the iOS shell, and ran production preview at `127.0.0.1:4173`. Info.plist contained `WKAppBoundDomains = [127.0.0.1]`; Capacitor config enabled `limitsNavigationsToAppBoundDomains` and set `server.url` to that origin. The home page, Device, and server-function context worked. Remote mode retained its native cookie path.

Visited `/offline-route` online. The first shutdown immediately after navigation raced the new worker's capture and showed the offline fallback. Repeated the check after observing an actual stored response in the current build's snapshot cache, rather than waiting a fixed delay. A temporary read-only native diagnostic reported `limitsNavigationsToAppBoundDomains = true`, controller `http://127.0.0.1:4173/radical-sw.js`, and a current-build cached response with `x-radical-offline: 1`. Native preferences recorded `radical.lastOfflineURL = http://127.0.0.1:4173/offline-route`, which the shell writes only after confirming that exact cached snapshot. Stopped preview and confirmed HTTP connection refusal, then terminated and reopened the app. It restored **Offline route** through the persistent worker. Tapping **Hydration check: 0** changed it to **Hydration check: 1** with the server still stopped. This verifies persistent worker recovery and usable cached JavaScript with App-Bound Domains enabled. Regenerated again to remove the worker diagnostics and repeated the offline cold launch with the clean shell. The PR includes the offline cold-launch screenshot.

## Repository checks

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `pnpm run ready`, and `pnpm install --frozen-lockfile` pass. The ready suite runs Ultracite, Vite checks, Effect type checks, and all 195 tests. Tests cover both generated shells and loading modes, config validation, request paths and bodies, native context precedence, credentials, CORS preflights, exposed Start headers, and CSRF origin checks. No lockfile changes or `@pnpm/exe` entries are included.

The API and preview servers were stopped, Gradle reported two daemons stopped, the port forward was removed, and `agent-device close` completed. The agent-device daemon was left running.
