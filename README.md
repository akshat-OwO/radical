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

## Icons and splash

Set `icon` and `splash` in the Radical config, then regenerate both shells. Radical validates and composites PNG or JPEG sources and writes Android and iOS resources directly with `sharp`. No asset-generator CLI is required. Android includes legacy, adaptive, and monochrome launcher resources; iOS includes the app icon and light and dark splash catalogs. See the [asset configuration](packages/radical/README.md#app-identity) and [output verification](docs/verification/native-assets.md).

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

## Camera capture and permission

Enable Camera explicitly and install the pinned plugin:

```sh
pnpm add @capacitor/camera@8.2.6
```

```ts
radical({
  appId: "dev.example.app",
  internalPlugins: { camera: true },
  pluginOptions: {
    Camera: {
      usageDescription: "Take a photo to attach to your report.",
      photoLibraryUsageDescription: "Choose a photo to attach to your report.",
    },
  },
});
```

Regenerate both shells after enabling it. Generation adds Android `CAMERA` with optional camera hardware, and iOS `NSCameraUsageDescription` plus `NSPhotoLibraryUsageDescription`. Both descriptions must contain non-whitespace text and no invalid XML control characters. When both camera and video stream are enabled, the single iOS camera description joins the still-camera purpose followed by the video purpose with a space. Identical descriptions appear once, and generation XML-escapes the combined string once. Photo-library access is declared only when the still camera is enabled. Android emits one shared `CAMERA` permission. Camera is disabled by default so existing apps gain no camera permissions.

```tsx
import { useCamera, useCameraPermission } from "radical/react";

function Camera() {
  const camera = useCamera();
  const permission = useCameraPermission();
  return (
    <>
      <p>{permission.error?._tag ?? permission.value ?? "Checking..."}</p>
      <button onClick={() => permission.request()}>
        Request camera access
      </button>
      <button disabled={camera.loading} onClick={() => camera.capture()}>
        Take photo
      </button>
      <p>{camera.error?._tag}</p>
      {camera.value && <img src={camera.value.dataUrl} alt="Captured photo" />}
    </>
  );
}
```

`useCamera()` returns `{ capture, choose, loading, value, error }`. `choose()` opens a single-image library picker. `value` is a `Photo`: `{ dataUrl, mimeType, width?, height? }`. The data URL stays valid after unmount. `width` and `height` are the decoded, orientation-corrected size, present whenever the runtime can decode the image. `useCameraPermission()` returns `{ check, request, loading, value, error }`. It checks after mount, reports `"granted" | "denied" | "prompt"`, and requests only after `request()` is called. `check()` refreshes after returning from system settings. A denied request sets `error` to `PermissionDenied`; a check can return `"denied"` without failing.

`CameraError` is `PermissionDenied | Cancelled | Unavailable | BridgeError`. Unexpected native codes remain `BridgeCallFailed`; invalid native results remain `BridgeDecodeError`. These error classes and result types are exported from `radical/react` and `radical/client`. The client entry also exports `capturePhoto`, `choosePhoto`, `checkCameraPermission`, and `requestCameraPermission` as Effects requiring `Bridge` and `BrowserCamera`. Use `cameraLive(effect)` to supply the default browser service, or an in-memory `BrowserCamera` layer for tests.

## Files and intents

Enable the file picker, intents, or both, and install the pinned plugins:

```sh
pnpm add @capawesome/capacitor-file-picker@8.1.1 @capacitor/app-launcher@8.0.1 @capacitor-community/file-opener@8.0.1
```

```ts
radical({
  appId: "dev.example.app",
  internalPlugins: { filePicker: true, intents: true },
});
```

`filePicker` adds `@capawesome/capacitor-file-picker`. `intents` adds `@capacitor/app-launcher` for URLs and `@capacitor-community/file-opener` for files. Neither adds platform permissions: the pickers use the system document UI, and the file opener grants read access per intent through its own `FileProvider`. Both are disabled by default so existing apps keep their dependency set.

```tsx
import { useFilePicker, useIntent } from "radical/react";

function Attachments() {
  const picker = useFilePicker();
  const intent = useIntent();
  const [first] = picker.value ?? [];
  return (
    <>
      <button onClick={() => picker.pick({ types: ["application/pdf"] })}>
        Attach PDF
      </button>
      <button disabled={!first} onClick={() => first && intent.openFile(first)}>
        Open attachment
      </button>
      <button onClick={() => intent.openUrl("https://example.com/help")}>
        Help
      </button>
      <p>{picker.error?._tag ?? intent.error?._tag}</p>
    </>
  );
}
```

`useFilePicker()` returns `{ pick, loading, value, error }`. `pick({ types?, multiple? })` accepts MIME types or `type/*` patterns; omitting `types` allows every file. `value` is a list of `PickedFile`: `{ name, mimeType, size, lastModified?, blob, uri? }`. Every runtime returns the same shape with the contents in `blob`, and `size` is the size of that blob. Files without a type report `application/octet-stream`; native files without a name use the last segment of their URI. `uri` is the native file URI (`content://` on Android, `file://` on iOS) and is absent in browsers. Picked files are read into memory, so avoid very large files.

`useIntent()` returns `{ openUrl, openFile, loading, value, error }`. `value` is `true` once the URL or file was handed to another app. `openUrl(url)` opens any parseable URL, such as `https:`, `mailto:` or `geo:`, in the app that handles it; browsers open a new tab. `openFile(file, { chooser? })` opens a picked native file in its default handler, or in the Android chooser or iOS Open In menu with `chooser: true`. Android may still show its "Open with" sheet when several apps can handle the type. On iOS the default handler is a Quick Look preview, and the action settles when the preview closes. Browser files have no URI, so `openFile` fails with `Unavailable` there.

`FilePickerError` is `Cancelled | Unavailable | BridgeError`. `IntentError` is `NoHandler | Unavailable | BridgeError`: `NoHandler` means no installed app accepted the URL or file, and `Unavailable` covers invalid URLs, missing files, and files without a native URI. The client entry exports `pickFiles`, `openUrl`, and `openFile` as Effects, with `filesLive` and `intentsLive` supplying the default browser services and `BrowserFiles` and `BrowserIntents` for in-memory test layers.

Browsers capture through `<input type="file" accept="image/*" capture="environment">`. Desktop browsers usually offer file selection; mobile browsers decide whether to offer a camera. Permission checks use the Permissions API where supported and otherwise report `"prompt"`. Requests require getUserMedia in a secure context and immediately stop the temporary stream. A successful file selection does not imply camera permission was granted.

Both hooks guard server rendering, ignore duplicate actions while busy, interrupt pending work on unmount, and clear state when the provider changes. Browser inputs and readers are cleaned up on success, failure, and interruption. Capacitor cannot dismiss an open native picker on interruption; keep one camera hook mounted until the picker closes. Android process-death restoration is not included. See the [example route](apps/example/src/routes/camera.tsx), [camera decision](docs/adr/0005-camera-capability-hooks.md), and [verification record](docs/verification/camera.md).

## Live video

`useVideoStream` from `radical/react` previews the camera through a viewfinder cut-out, scans QR codes, and exposes start, stop, camera switching, zoom, torch, and frame-rate state. Enable `internalPlugins.videoStream` and provide `pluginOptions.VideoStream.usageDescription`. Browser previews use `getUserMedia`; QR detection requires `BarcodeDetector`. See the [package API](packages/radical/README.md#live-video), [plugin decision](docs/adr/0007-live-video-stream.md), and [device verification](docs/verification/video.md).

## Haptic feedback

Install `@capacitor/haptics@8.0.2`, enable `internalPlugins: { haptics: true }`, and regenerate both shells. Haptics is opt-in and needs no runtime permission prompt.

```tsx
import { useHapticFeedback } from "radical/react";

function SaveButton() {
  const feedback = useHapticFeedback();
  return <button onClick={feedback.success}>Saved</button>;
}
```

The hook returns stable `light()`, `medium()`, `heavy()`, `success()`, `warning()`, `error()`, `selection()`, and `impact(style?)` callbacks. Impact styles are `"LIGHT"`, `"MEDIUM"`, and `"HEAVY"`; `impact()` defaults to medium. `loading` marks an in-flight call, `value: true` marks completion, and `failure` contains `BridgeError` or `HapticFeedbackFailed`. The failure field leaves `error()` available as the notification helper. Completion confirms the call, not physical vibration.

Each hook suppresses overlapping actions and interrupts pending work on unmount or provider replacement. Actions remain idle during server rendering. Browser feedback uses `navigator.vibrate` with approximate patterns. Missing APIs and a `false` return are successful no-ops, including browsers that block vibration. A thrown browser exception becomes `HapticFeedbackFailed`. Native devices without a haptic engine also complete without feedback.

Effect callers import `hapticImpact(style?)`, `hapticNotification(type)`, and `hapticSelection` from `radical/client`. Notification types are `"SUCCESS"`, `"WARNING"`, and `"ERROR"`. Supply `Bridge` and the injectable `BrowserHaptics` service, or use `hapticsLive(effect)` to supply `BrowserHapticsLive`. See [ADR 0008](docs/adr/0008-haptics.md) and [device verification](docs/verification/haptics.md).

## Network status

Enable `internalPlugins: { network: true }`, install `@capacitor/network@8.0.1`, and regenerate both shells. The plugin is opt-in and needs no permission prompt.

```tsx
import { useNetworkStatus } from "radical/react";

function Network() {
  const network = useNetworkStatus();
  if (network.loading) return <p>Reading network status...</p>;
  if (network.error) return <p>{network.error._tag}</p>;
  return (
    <p>
      {String(network.value.connected)}: {network.value.connectionType}
    </p>
  );
}
```

The hook subscribes after mount and updates live. SSR and the first hydration render return `{ loading: true, value: undefined, error: undefined }`. Unmount and provider replacement remove the listener and interrupt pending work. `connected` describes local connectivity, not whether an internet endpoint is reachable. Offline reports type `none`. Native types are `wifi`, `cellular`, `none`, or `unknown`; browsers can also report `ethernet`, `bluetooth`, `wimax`, or `other`. Browsers use `navigator.onLine` and online/offline events, plus `navigator.connection` change events when available. Without network-type support, an online browser reports `unknown`.

`radical/client` exports `getNetworkStatus`, `watchNetworkStatus`, `NetworkStatusSchema`, `NetworkTypeSchema`, `BrowserNetwork`, `BrowserNetworkLive`, `browserNetworkLayer`, and `networkLive`. The Effect and Stream require `Bridge` and `BrowserNetwork`. Wrap a stream consumer Effect with `networkLive` for the default browser service, or inject an in-memory layer. Unexpected native failures are `BridgeCallFailed`; malformed results and events are `BridgeDecodeError`; missing native listener support is `BridgeUnavailable`. See [network verification](docs/verification/network.md).

Google sign-in is available through `useGoogleSignIn` in both native shells. Enable `internalPlugins.googleSignIn` and supply public OAuth client IDs in `pluginOptions.GoogleSignIn`. See [Google sign-in setup](packages/radical/README.md#google-sign-in) and [ADR 0011](docs/adr/0011-google-sign-in.md).

## Notifications

Enable `internalPlugins.notifications` and install `@capacitor/local-notifications@8.3.1`, `@capawesome/capacitor-badge@8.0.4`, and `@capacitor/network@8.0.1`. Regenerate shells after changing plugin flags. `useNotificationPermission()` exposes `check`, `request`, `loading`, `value`, and `error`. Permission values are `prompt`, `granted`, and `denied`. It checks after mount and prompts only when you call `request`.

`useNotifications()` exposes `schedule`, `cancel`, `setBadge`, `clearBadge`, `registerPush`, `subscribe`, `unsubscribe`, and `lookupTopics`, plus `loading`, `value`, and `error`. Actions run after mount and ignore overlapping calls. Server rendering leaves both hooks idle and never reads browser APIs.

```tsx
const notifications = useNotifications();
notifications.schedule({
  id: 22,
  title: "Reminder",
  delaySeconds: 5,
  route: "/offline-route",
});
notifications.cancel(22);
```

Notification IDs are positive 32-bit integers. Scheduling the same ID replaces its pending reminder. Delays must be positive finite seconds. Routes must be app-relative paths starting with one slash. Native delivery follows the OS scheduler and may be delayed by power management. Browsers use the Notification API and require permission, a secure context, and an open page. They cannot deliver after the page closes. Badge updates require a supported native launcher. Invalid inputs and unsupported operations return `Unavailable`; denied permission returns `PermissionDenied`.

For push and topics, also enable `internalPlugins.pushNotifications` and install `@capacitor-firebase/messaging@8.5.2`. This flag includes local notifications and badges. Supply your own Firebase files for the shell's platform identity:

```ts
notifications: {
	android: { googleServices: "./private/google-services.json" },
	ios: {
		googleServiceInfo: "./private/GoogleService-Info.plist",
		environment: "development",
	},
},
```

Paths resolve from the app root. The generator copies files into the ignored shell, adds the iOS resource and push entitlement, and wires APNs callbacks. Set `environment: "production"` for distribution and configure signing with Push Notifications enabled. Upload an APNs key or certificate to Firebase. Never commit `google-services.json` or `GoogleService-Info.plist`. Without Firebase configuration, local scheduling still works and push operations return `MissingPushConfiguration`. `registerPush` requires notification permission and returns an FCM token. Browsers report push and topics as `Unavailable`.

`subscribe(topic)`, `unsubscribe(topic)`, and `lookupTopics()` return the installation's confirmed topic memberships in `value`. Topic names accept 1–900 letters, digits, underscores, periods, tildes, percent signs, and hyphens. Lookup reads a persistent local record of successful operations, not Firebase's server state. Reinstalling the app clears it. Changes made outside Radical are not reflected.

Mount `watchNotificationNavigation({ appId, push: true })` in an app-wide Effect scope. Provide `BridgeLive`, `NotificationSnapshotsLive`, and your adapter's client navigation layer. Interrupt the fiber on unmount to remove its listeners. Local taps read `notification.extra.route`; push taps read `notification.data.route`. Only the `tap` action navigates. When offline, the watcher checks stored snapshots first and uses full-document navigation for a matching URL. Otherwise it calls the adapter's navigation hook. The example's root route shows the TanStack Start setup. Visit an offline route before expecting its snapshot to exist.

## Data protection

Enable `internalPlugins.dataProtection: true` and use `useDataProtection` from `radical/react`. `setEnabled(true)` enables Android screen capture blocking and iOS capture and app-switcher obscuring. iOS cannot block screenshots; browsers report protection as unsupported. `clearWebData()` deletes accessible browser storage and native WebView data, including offline snapshots and cached manifests. Stop app writes and close database connections first. See the [API and platform limits](packages/radical/README.md#data-protection) and the example's `/data-protection` page.
