# Run the example

From the workspace root, install dependencies and build the radical package:

```sh
pnpm install
pnpm --filter radical exec vp pack
```

Start the TanStack Start example:

```sh
cd apps/example
pnpm exec vp dev
```

Build the example with `pnpm exec vp build` in the same directory.

`vite.config.ts` registers `radical/tanstack-start` next to `tanstackStart()`. Change `appId` to `invalid` to see config validation reject dev and build with an error naming `appId`. Restore `dev.radical.example` to run the app again.

The root wraps the app in the optional `RadicalProvider`, which defaults to `BridgeLive`. Pass a stable custom `layer` there to replace the bridge for all hooks. The home page displays `useDeviceInfo` from `radical/react` after mount. Browsers show browser-derived info. Generated shells call the official Device native plugin and show its model and OS version. See the [bridge reference](../../docs/reference/bridge.md) for the Effect service, typed errors, and hook state.

The root reads native context through the request middleware in remote mode and from the shell in bundled mode. The home page's **Call server function** button reads it from the server in either mode. To check server rendering, run these commands while the dev server is running:

```sh
curl -fsS http://localhost:5173/
curl -fsS -b 'radical-context=%7B%22platform%22%3A%22ios%22%2C%22safeArea%22%3A%7B%22top%22%3A47%2C%22right%22%3A0%2C%22bottom%22%3A34%2C%22left%22%3A0%7D%2C%22shellVersion%22%3A%221.0.0%22%7D' http://localhost:5173/
curl -fsS -b 'radical-context=malformed' http://localhost:5173/
```

The first and third responses show browser context with zero insets. The second shows iOS with the supplied insets and shell version. The [shared cookie contract](../../packages/radical/src/native-context.ts) defines the format.

To verify browser offline behavior, build and preview the production app:

```sh
pnpm exec vp build
pnpm exec vp preview
```

1. Open `/offline-route?view=one` and wait for the service worker to activate. This route declares `staticData.radical.offline` and has a counter to check hydration.
2. Disable the network in browser developer tools, then reload that exact URL. The snapshot loads, and the counter still works with the precached scripts.
3. Open `/offline-route?view=two` without visiting it online first. The app's `public/offline.html` fallback appears.
4. Open `/online-route` while offline. This route has no offline snapshot and shows the same fallback.
5. Re-enable the network. After another build, close all tabs for this origin and reopen the app to let the new worker activate and remove the old build's caches.

Stop the preview server when finished. Dev mode does not register a service worker. Use a fresh browser profile or unregister an existing production worker before checking dev mode at the same origin.

## Android offline routes

The example sets `devHost: "localhost"` for a secure loopback origin. Forward the server port before opening the shell. For ordinary LAN development, change `devHost` to your computer's LAN address. Offline caching requires the production build.

Run these commands from `apps/example` with the already booted Android emulator:

```sh
adb -s emulator-5554 reverse tcp:4173 tcp:4173
pnpm exec vp dev --port 4173
```

Once dev starts, stop it. This creates `.radical/native.json` pointing at `http://localhost:4173`. Then build and preview:

```sh
pnpm exec vp build
pnpm exec vp preview --host 0.0.0.0 --port 4173
```

In another terminal, run `pnpm exec radical android --target emulator-5554`. Open **Offline route**, and wait for the worker to activate. In WebView DevTools, confirm that `navigator.serviceWorker.controller` is present and Cache Storage contains a snapshot for `/offline-route`.

1. Stop the preview server. This also disconnects localhost traffic, which Wi-Fi toggles alone cannot block through `adb reverse`.
2. Follow **Home** to see the worker's offline fallback, then **Open the offline route** to open the stored snapshot. Tap **Hydration check** to verify that cached scripts work.
3. Force-stop the app with `adb -s emulator-5554 shell am force-stop dev.radical.example.android`. Reopen it while the server remains stopped. Disable Wi-Fi and mobile data with `adb -s emulator-5554 shell svc wifi disable` and `adb -s emulator-5554 shell svc data disable`. The last visited offline route opens directly from its snapshot. Android connectivity selects this route; an online launch opens the configured server URL. Visiting an online-only route does not replace the saved offline URL.
4. Run `adb -s emulator-5554 shell pm clear dev.radical.example.android`, then reopen the app offline. The packaged fallback appears because snapshots and worker registrations were removed. **Try again** retries the failed URL after connectivity returns.
5. Restart preview and reopen the app to capture fresh snapshots. Restore any disabled network interfaces, stop preview, and run `./gradlew --stop` from `.radical/android/android` when finished. Leave the emulator booted.

Screenshots and observed results are in [Android offline verification](../../docs/verification/android-offline.md).

## App identity

The example config uses `Radical Android` with package id `dev.radical.example.android` and `Radical iOS` with bundle id `dev.radical.example.ios`. Both use the square-root launcher icon and a white square-root splash on `#241044`. The shared `appId` remains `dev.radical.example` for offline storage. Use the platform identifier in device install, launch, and clear-storage commands.

Regenerate the small source PNGs with `python3 assets/generate.py` from this directory. After an identity change, start dev to refresh native config, then run `pnpm exec radical ios --generate-only` and `pnpm exec radical android --generate-only`. See the [app identity reference](../../packages/radical/README.md#app-identity) for source requirements and name precedence.

## Switch loading modes

Set `mode: "bundled"` in `vite.config.ts`, keep `origin` pointed at your API, and run `pnpm exec radical android --target emulator-5554`. The CLI builds and packages the UI. On the emulator, use `adb reverse tcp:4173 tcp:4173` for the example's `http://localhost:4173` origin. The API server must run the matching server build. No UI dev server is needed. **Call server function** shows the context returned by the API; Device and the slide and fade links use the native bridge.

Set `mode: "remote"` and regenerate to load from the same origin. For development at port 5173, set `origin` to `http://localhost:5173`, or omit it to use the dev server's recorded URL. The default example origin is port 4173 for production preview. See the root [bundled mode guide](../../README.md#bundled-ui-with-a-remote-api) for API-server setup and authentication limits.

## Camera

Open `/camera` from the home page. The example enables `internalPlugins.camera` with its own usage description. **Check permission** reads current state; **Request permission** prompts for camera access. **Capture photo** opens the native camera or browser capture input, and **Choose photo** opens an image picker. Both display the normalized image and MIME type. On iOS simulators, the camera may open a black viewfinder without producing a frame. Dismiss it to check `Cancelled`, then use **Choose photo** to verify native image results. Use a physical iPhone to verify hardware capture.

## Files and intents

Open `/files` from the home page. The example enables `internalPlugins.filePicker` and `internalPlugins.intents`. **Pick file** opens the system document picker for any file; **Pick images or PDFs** filters by type and allows several files. The page lists each file's name, MIME type, and size. **Open URL** opens `https://example.com/` in the default browser. **Open picked file** hands the first native file to an external app; in a browser it reports `Unavailable`.

## Live video and QR scanning

Open `/video` from the home page. Press **Start** to show the native camera through the bordered cut-out, **Switch camera** to select the other camera, and **Stop** to release it. The page shows the last QR value and frame rate. Zoom uses the camera's reported range; torch is disabled when unavailable. Browsers use a media stream and report when QR detection is unavailable. The example enables `internalPlugins.videoStream` with its own camera explanation.

Build radical before generating or building either shell because this app imports the package's built dist. See [video verification](../../docs/verification/video.md) for commands, device evidence, and simulator limits.

## Haptics

Open `/haptics` from the home page. The example enables `internalPlugins.haptics`. The buttons exercise light, medium, and heavy impacts, success, warning, and error notifications, selection feedback, and the default medium impact. `Sent` confirms completion, and failures display their typed tag. Unsupported browsers do nothing. Use a physical device to assess vibration strength and notification patterns; simulators only verify plugin dispatch. See [verification](../../docs/verification/haptics.md).

## Network status

Open `/network` from **Network status** on the home page. The example enables `internalPlugins.network` and displays connected state and connection type, updating on native or browser events. Disable and restore connectivity while the page remains mounted. Use bundled mode for offline checks so the UI does not depend on a running preview server. Build radical before building the example or generating shells. See [network verification](../../docs/verification/network.md) for commands, observations, and iOS simulator limits.
