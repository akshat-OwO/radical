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
