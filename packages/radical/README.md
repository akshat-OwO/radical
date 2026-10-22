# radical

Run server-rendered web apps inside native Android and iOS WebView shells.

`radical/vite` validates the core config. `radical/tanstack-start` registers the core plugin and exports the Effect adapter layer. See the [example app](../../apps/example/README.md) for setup and the [architecture ADR](../../docs/adr/0001-framework-agnostic-native-shell-plugin.md) for the planned native behavior.

## App identity

```ts
radical({
  appId: "dev.example.app",
  name: "Example",
  android: { name: "Example Android", packageId: "dev.example.android" },
  ios: { name: "Example iOS", bundleId: "dev.example.ios" },
  icon: { image: "./assets/icon.png", backgroundColor: "#6d28d9" },
  splash: { image: "./assets/splash.png", backgroundColor: "#241044" },
});
```

`appId` is the shared identity used for offline storage. It is dot-separated, with segments starting with a letter and containing letters, digits, or underscores. `android.packageId` and `ios.bundleId` default to `appId`. Android ids use Java package segments and reject Java keywords. iOS bundle ids contain dot-separated letters, digits, and hyphens. A shared id that is invalid on a platform requires an explicit override for that platform.

The display name resolves from the platform's `name`, then shared `name`, then legacy `appName`, then `appId`. Names must be nonempty. The generated iOS `CFBundleDisplayName` and Android `app_name` use that name. Android's application id, namespace, activity, and copied plugin sources all use `android.packageId`. A copied plugin's qualified class name must match that package. An unqualified class name works with any package override.

`icon` and `splash` are optional. `icon` accepts a path string or `{ image, backgroundColor? }`. The icon background defaults to `#ffffff` and requires an opaque `#RRGGBB` colour, like the splash background. Android adaptive foregrounds retain the source alpha over a solid background of this colour. Legacy Android and iOS icons are flattened onto the same colour so they are opaque. Image paths resolve relative to the app root. Sources must be decodable square PNG or JPEG images, at least 1024×1024 pixels for icons and 2732×2732 for splash screens. `splash.backgroundColor` requires an opaque `#RRGGBB` colour. Radical composites transparent splash pixels onto this colour for both light and dark appearances. Opaque source pixels keep their colours. Android 12 and later use a dedicated square splash drawable as a system-sized icon on the configured background. It preserves the source image proportions independently of the portrait and landscape splash resources used on older Android versions. The iOS shell retains the configured splash during cookie setup and the first document load, then removes it when that document or its offline fallback finishes loading.

Install `@capacitor/assets@3.0.5` alongside your Capacitor toolchain to generate custom assets. Radical resolves its installed version and pins it in the generated package, like the other Capacitor dependencies. Generation invokes its local CLI through Effect's child-process service, with `generate --ios` or `generate --android` and normalized custom-mode inputs. It never invokes a package downloader or generates PWA assets. Generated iOS splash images are limited to 2048×2048 pixels so their decoded allocation stays below the system launch-image limit. The launch storyboard uses a content-derived splash resource name so changed images invalidate UIKit's named-image cache.

After changing config or source images, start dev to refresh `.radical/native.json`, then run `radical ios --generate-only` and `radical android --generate-only`. Each command replaces its project, including names, identifiers, icons, and splash resources. Missing files, unsupported or corrupt images, and invalid dimensions fail with `InvalidAsset` naming the path and constraint. Schema errors name invalid config fields. Tool failures and missing generated resources fail with `AssetGenerationFailed`. Failed generation preserves the previous project.

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

## Offline routes

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

`offlineHandler` reads the final loaded match's `staticData.radical.offline` and sets `x-radical-offline`. It marks eligible documents in browsers, Android shells, and iOS shells without decoding native context. TanStack owns all route selection, including static precedence, optional parameters, and decorated parameters. Parent opt-in does not implicitly opt in a child. `TanStackStartAdapter` remains a Layer; routes remain empty and navigation reports `AdapterUnavailable`.

The plugin writes `radical-manifest.json` and bundles a small standalone `radical-sw.js` into the client output. The manifest contains the client assets, fallback URL, cache prefix, and a build id derived from the worker, asset contents, and fallback contents. Identical builds preserve caches. Provide a standalone fallback document at `public/offline.html`.

Call `registerOffline({ production: import.meta.env.PROD, base: import.meta.env.BASE_URL })` from `radical/client` in a root `useEffect`. It returns a Promise and needs no Effect import in the app. It registers in production browsers, Android shells, and iOS shells with service worker support. Registration does not take a `platform` option. See the example root route. `registerOfflineEffect` exposes the underlying Effect with `ServiceWorkerRegistrationError` for Effect consumers.

The service worker loads documents network first and saves successful HTML carrying `x-radical-offline: 1`. Snapshots use exact URLs, including query strings. It captures an already open offline route on first activation, precaches client assets for hydration, and serves the fallback for offline URLs without a snapshot. A new worker waits for the old worker's clients to close before activation removes previous build caches for the same app and base path.

The worker uses native Promises and Cache Storage without an Effect runtime. Build and registration operations use Effect with typed errors. The same worker policy runs against in-memory services in the unit tests.

## Run an Android shell in remote mode

Install Android SDK platform 36, build tools, an emulator system image, and Java 21. Set `ANDROID_HOME` and `JAVA_HOME` for your installation. The generated project uses its Gradle wrapper.

Install the optional native peers with `pnpm add @capacitor/core@8 @capacitor/android@8` and `pnpm add -D @capacitor/cli@8`.

Start your host framework's dev server, then run `pnpm exec radical android` from the app directory in another terminal. The Vite plugin binds the dev server to the LAN (`0.0.0.0`) so devices can reach it, unless you set `server.host` yourself, and writes `.radical/native.json` with the selected port. Use `devHost` in the radical config to select a reachable LAN address, or `10.0.2.2` for the Android emulator's host alias. The CLI reads that file, regenerates `.radical/android`, and builds and runs the shell. The CLI prefers a connected emulator or device. If none are running, it prompts you to select an installed AVD, starts it, and waits up to 120 seconds for Android to finish booting. Use `--target Pixel_9` to select an AVD by name, `--target emulator-5554` to select a serial, or `--generate-only` to skip building and running. A running AVD is reused. The runner reads `ANDROID_HOME`, falling back to `ANDROID_SDK_ROOT`, and otherwise looks for `adb` and `emulator` on PATH.

The server origin is always allowed. Add exact HTTP or HTTPS origins to `allowlist` to permit additional navigation. Origins include their port and have no trailing slash. Other navigation is blocked. The allowlist does not restrict ordinary subresources or worker fetches, including redirects. Before the first load, the shell sets the native context cookie on every allowed origin with `CookieManager`, so the WebView sends it with every request: navigations, fetch and XHR, form posts, and service-worker requests.

The WebView draws edge to edge. Before the first request, the shell measures system-bar and cutout insets in CSS pixels and stores them in the native context cookie. Shell scripts keep the `--radical-safe-area-*` CSS variables current, including after rotation or keyboard dismissal. Native projects and local edits in them are disposable. Templates ship with the package; regeneration replaces the previous project after successful generation. This command regenerates only the Android shell.

### Android offline loading

Android uses the same stable worker URL and build-versioned caches as browsers. The allowlist remains a top-level navigation policy. `shouldOverrideUrlLoading`, main-frame interception, `onPageStarted`, and the document-start guard also protect worker-served navigations and redirects. Cross-origin images, CDNs, analytics, and worker fetches use ordinary Chromium networking.

Allowed remote main-frame requests return `null` from native interception rather than delegating to Capacitor's document proxy. The bridge comes from Capacitor's document-start injection, including on worker-served snapshots. The generated `android.resolveServiceWorkerRequests: false` prevents Capacitor from installing a worker proxy. Radical's optional worker client serves only the packaged startup and fallback pages. Missing worker interception support no longer terminates the app.

On startup, a packaged page at the reserved `/.radical/launch` path completes `navigator.serviceWorker.getRegistration(target)` before navigating with `location.replace`. This establishes the origin and registration lookup before the app navigation, so a cold WebView can dispatch that navigation through the stored worker. It does not register another worker, fetch the app twice, or use a timer. Without the worker API, startup proceeds directly to the target.

Android connectivity selects the target. With an active network carrying `NET_CAPABILITY_INTERNET`, the shell opens the configured server URL. Without one, it opens the last URL with a completed snapshot, or the server URL if none exists. The generated manifest grants `ACCESS_NETWORK_STATE`. A disconnected server while Android still reports a connected network does not trigger session restoration.

The shell records a URL only after Cache Storage confirms an exact-URL snapshot in this app's snapshot caches. The worker captures only eligible HTML carrying `x-radical-offline: 1`, so this signal follows the framework's actual route selection rather than duplicating route-pattern matching natively. An origin-restricted, main-frame web message reports the result. First activation notifies the page after its initial capture completes. Online-only routes and packaged pages do not replace the saved offline URL.

A controlling worker serves the snapshot or the app's cached `public/offline.html`. If a main-frame load fails without a usable worker, `onReceivedError` displays the standalone HTML shipped in `templates/offline.html`, embedded in the generated Activity and served at `/.radical/offline`. It has no external assets and offers a retry link to the failed URL. The URL must pass the navigation allowlist and is HTML-escaped. It works on a first offline launch without any web cache. Subresource errors do not replace the document.

Cache Storage and worker registrations live in Android WebView's app-private data directory. Android **Clear storage**, or `adb shell pm clear <appId>`, removes them together with cookies and the saved offline URL. The packaged fallback survives. No native clear API is needed for this behavior. The `clearWebData` hook remains tracked in #24.

Service workers require HTTPS or a trustworthy loopback origin. An HTTP LAN address or `10.0.2.2` does not qualify. Use `devHost: "localhost"` and `adb -s emulator-5554 reverse tcp:4173 tcp:4173` for Android offline verification. Build and preview the production app because dev mode does not register workers. See the [example procedure](../../apps/example/README.md#android-offline-routes).

## iOS offline loading

The generated iOS shell enables App-Bound Domains before creating the WebView and uses the persistent default website data store. Generation rejects more than ten distinct hostnames across the server origin and allowlist. Keep the shared worker on one stable app origin; the spike observed a ceiling of three worker origins. The navigation proxy still checks exact origins, including ports. App-Bound Domains do not replace that policy or restrict ordinary cross-origin subresources and worker fetches.

Startup loads the configured server URL. If that navigation fails or the worker returns its marked offline fallback, the shell tries the last URL with a confirmed snapshot once. The tested WebKit restores the worker on the first cold navigation, so iOS needs no startup gate. Unrelated cancellations, failures at disallowed URLs, and failures while the packaged fallback is already shown still reach Capacitor's delegate. The proxy consumes cancellations for the exact navigations replaced by its own recovery, once per navigation. Capacitor's configured packaged error-page URL can load through the response guard; remote URLs still require an allowed exact origin. Radical skips Capacitor only when it starts a snapshot or packaged fallback navigation, avoiding a competing `errorPath` load for the same failure.

For an allowed main-frame load failure, the shell loads the packaged `templates/offline.html` with `loadHTMLString(_:baseURL:)` and the failed allowed URL as its base. It needs no worker or external assets and follows light and dark appearance. Removing all website data removes snapshots and registrations; uninstalling and reinstalling also removes the saved URL preference. The public `clearWebData` hook remains #24.

Use a production build at HTTPS or localhost. The iOS simulator shares the host network, so `http://localhost:4173` works without port forwarding. Stop preview to test offline. Plain HTTP LAN origins are not secure contexts. See [iOS verification](../../docs/verification/ios-offline.md) for the procedure and screenshots.

## Camera

`radical/react` exports `useCamera` and `useCameraPermission`. Enable `internalPlugins.camera` with `pluginOptions.Camera.usageDescription` and `photoLibraryUsageDescription` and install `@capacitor/camera@8.2.6` before regenerating shells. See the [camera API and configuration](../../README.md#camera-capture-and-permission) for result types, typed errors, browser behavior, and lifecycle limits.

## Files and intents

`radical/react` exports `useFilePicker` and `useIntent`. Enable `internalPlugins.filePicker` and `internalPlugins.intents`, install `@capawesome/capacitor-file-picker@8.1.1`, `@capacitor/app-launcher@8.0.1`, and `@capacitor-community/file-opener@8.0.1`, then regenerate shells. See [files and intents](../../README.md#files-and-intents) for result types, typed errors, and browser behavior.

## Live video

Enable `internalPlugins: { videoStream: true }` and set `pluginOptions.VideoStream.usageDescription` to a nonblank camera explanation. This installs the pinned optional `@capgo/camera-preview@8.14.2` plugin and generates camera permissions without microphone or photo-library access.

```tsx
const viewfinder = useRef<HTMLDivElement>(null);
const camera = useVideoStream({ viewfinder, onDetect: console.log });
return (
  <>
    <button onClick={() => camera.start()}>Start</button>
    <button onClick={() => camera.stop()}>Stop</button>
    <div ref={viewfinder} style={{ height: 300 }} />
  </>
);
```

The hook starts only from an explicit action and stays idle during SSR. `running`, `loading`, `value`, and `error` describe the session. `value` includes `facing`, optional `zoom: { min, max, current }`, `torch`, `torchAvailable`, optional `frameRate`, and `detectionAvailable`. Call `switchCamera()`, `setZoom(level)`, or `setTorch(enabled)` while running. Use the reported ranges and availability to enable controls. `onDetect(value)` receives each decoded QR result, including repeats while the code remains visible.

Mount one hook per camera session. Keep the viewfinder's ancestors transparent while streaming, and cover the rest of the screen with opaque overlays. The hook clears ancestor backgrounds temporarily and restores their inline values on stop or unmount. It cannot clear backgrounds from unrelated elements or pseudo-elements. The [example route](../../apps/example/src/routes/video.tsx) uses an opaque control section and a shadow around the cut-out. The native preview fills the shell behind the WebView; browser video fills the viewfinder element.

Unmount and provider replacement release the session. Stop also cancels pending startup; native cleanup waits for startup to settle before sending stop. Browser media tracks that arrive after cancellation are stopped. Browsers require a secure context and camera access. QR detection requires the browser's `BarcodeDetector` API or an application-supplied polyfill; preview still works without it. Native Android detection can wait for Google Play Services to download its model on first use. Physical torch and zoom behavior depends on the camera hardware.

Effect callers import `startVideoStream`, `videoStreamLive`, `BrowserVideoStream`, and `BrowserVideoStreamLive` from `radical/client`. Run `startVideoStream({ viewfinder, onDetect })` inside `Effect.scoped`, provide a Bridge layer and BrowserVideoStream layer, and keep the scope open for the preview's lifetime. The returned session has `info`, `switchCamera`, `setZoom`, and `setTorch` Effects. Tests inject browser and bridge layers instead of accessing devices. Failures include `PermissionDenied`, `Unavailable`, and bridge errors.
