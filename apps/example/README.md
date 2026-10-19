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
