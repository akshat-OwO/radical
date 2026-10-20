# Android offline routes verification

Verified on 2026-10-20 using only the already booted Pixel_9, Android 16, serial `emulator-5554`. The installed WebView reports Chromium 155. The generated debug app is `dev.radical.example`. No other emulator or simulator was started.

## Setup

Built radical with `pnpm --filter radical run build` and the example with `pnpm --filter @radical/example run build`. Generated `.radical/native.json` by starting dev on port 4173 with `devHost: "localhost"`, then stopped dev. Ran the production preview on that port and forwarded it with `adb -s emulator-5554 reverse tcp:4173 tcp:4173`.

Built, installed, and launched with Java 21 and:

```sh
pnpm --filter @radical/example exec radical android --target emulator-5554
```

The CLI finished successfully and stopped Gradle. UI navigation and screenshots used the T3 Device panel's agent-device CLI and existing device session. WebView CDP inspection through an adb-forwarded debug socket checked worker state and Cache Storage. Preview was stopped for every offline check. Stopping the server also blocks localhost requests through adb reverse, which Wi-Fi toggles alone do not block.

The online page reported `isSecureContext: true`, controller `http://localhost:4173/radical-sw.js`, and one registration at `http://localhost:4173/`. Cache Storage contained build-versioned `:assets` and `:snapshots` caches. The snapshot key was exactly `http://localhost:4173/offline-route`.

## Offline snapshot

With preview stopped, **Home** displayed the worker's cached `public/offline.html`. **Open the offline route** then loaded the visited route from its snapshot. Tapping the counter changed **Hydration check: 0** to **Hydration check: 1**, proving that the precached scripts hydrated the snapshot.

![Offline snapshot with working hydration](android-offline/snapshot.png)

![Worker fallback for a URL without a snapshot](android-offline/worker-fallback.png)

## Offline cold launch

Force-stopped the process with `adb -s emulator-5554 shell am force-stop dev.radical.example` and launched `.MainActivity` again while preview remained stopped. The shell restored the last URL. On this WebView, its first load reached the packaged fallback before worker control. It displayed radical's **You're offline** page, with a retry link to `/offline-route`, and no WebView error page.

Cache inspection after restart confirmed that the snapshot still existed. Tapping **Try again**, with preview still stopped, loaded the snapshot and its counter. The acceptance criterion permits either a snapshot or the fallback at launch. This run establishes fallback recovery at cold launch, not automatic snapshot rendering on the first cold request.

![Cold launch with the packaged fallback](android-offline/cold-launch.png)

The packaged fallback is embedded in the generated Activity and served by native interception at `/.radical/offline` on the allowed shell origin. A query parameter carries the failed URL. The native handler validates and HTML-escapes that URL before building the retry link. The page has no external assets. Its content security policy disables page scripts. Loading it through the allowed origin preserves the navigation guard and works without a worker or web cache.

## Clear storage

Ran `adb -s emulator-5554 shell pm clear dev.radical.example` after storing and reopening the snapshot. The command returned `Success`; `run-as dev.radical.example ls` showed no remaining app data before relaunch. Launched again with preview stopped. The packaged fallback appeared, and WebView inspection returned:

```json
{
  "controller": null,
  "caches": [],
  "registrations": 0
}
```

![Offline launch after clearing storage](android-offline/cleared-storage.png)

Snapshots and worker registrations use WebView's app-private storage. Android Clear storage removes them and the last-URL preferences. The fallback ships in the APK and survives. This change adds no native clear API or `clearWebData` hook.

## Worker allowlist

Issued network fetches inside the worker's own execution context. The allowed `http://localhost:4173/offline.html` returned 200. A no-CORS fetch to `http://127.0.0.1:4173/offline.html` reached radical's native interceptor and logged:

```text
RadicalNavigation: Blocked http://127.0.0.1:4173/offline.html
```

The JavaScript response was opaque, as expected for no-CORS. The native policy returns 403 for a blocked request. Both WebView subresources and worker network requests call the same interceptor. The generated config disables Capacitor's `android.resolveServiceWorkerRequests` so bridge setup cannot replace radical's process-wide worker client. The client is installed before bridge setup, using the feature checks required by [AndroidX WebKit](https://developer.android.com/reference/androidx/webkit/ServiceWorkerClientCompat).

## Checks and cleanup

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `pnpm install --frozen-lockfile`, and `pnpm run ready` passed. The ready command covers the package build, formatting, lint, TypeScript, Effect diagnostics, and all 108 tests. In-memory tests cover Android eligibility and registration, iOS exclusion, exact snapshot URLs, build cache isolation, and generated fallback/configuration output.

Stopped all dev and preview servers and ran the generated project's `./gradlew --stop`. Restored Wi-Fi and mobile data, removed the temporary adb forwards, and left Pixel_9 booted.
