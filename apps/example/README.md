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

The home page renders native context from the request middleware through a typed server function and route loader. To check server rendering, run these commands while the dev server is running:

```sh
curl -fsS http://localhost:5173/
curl -fsS -H 'x-radical-context: {"platform":"ios","safeArea":{"top":47,"right":0,"bottom":34,"left":0},"shellVersion":"1.0.0"}' http://localhost:5173/
curl -fsS -H 'x-radical-context: malformed' http://localhost:5173/
```

The first and third responses show browser context with zero insets. The second shows iOS with the supplied insets and shell version. The [shared header contract](../../packages/radical/src/native-context.ts) defines the format.

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
