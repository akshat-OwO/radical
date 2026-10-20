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

The home page renders native context from the request middleware through a typed server function and route loader. To check server rendering, run these commands while the dev server is running:

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
3. Force-stop the app with `adb -s emulator-5554 shell am force-stop dev.radical.example`. Reopen it while the server remains stopped. Disable Wi-Fi and mobile data with `adb -s emulator-5554 shell svc wifi disable` and `adb -s emulator-5554 shell svc data disable`. The last visited offline route opens directly from its snapshot. Android connectivity selects this route; an online launch opens the configured server URL. Visiting an online-only route does not replace the saved offline URL.
4. Run `adb -s emulator-5554 shell pm clear dev.radical.example`, then reopen the app offline. The packaged fallback appears because snapshots and worker registrations were removed. **Try again** retries the failed URL after connectivity returns.
5. Restart preview and reopen the app to capture fresh snapshots. Restore any disabled network interfaces, stop preview, and run `./gradlew --stop` from `.radical/android/android` when finished. Leave the emulator booted.

Screenshots and observed results are in [Android offline verification](../../docs/verification/android-offline.md).
