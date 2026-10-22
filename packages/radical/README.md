# @akshatowo/radical

Run server-rendered web apps inside Android and iOS WebView shells. Radical generates native projects from your Vite config and connects React hooks and Effect APIs to device capabilities. TanStack Start owns routing and server rendering.

## Get started

Install Radical in your app:

```sh
pnpm add @akshatowo/radical
```

Follow [installation](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/getting-started/installation.mdx) for a standalone TanStack Start app with every required file, middleware, SSR handler, and root provider. No Radical repository clone is required.

Then review [project structure](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/getting-started/project-structure.mdx) and [run on Android or iOS](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/getting-started/native.mdx). The CLI command remains `radical`:

```sh
pnpm exec radical android
pnpm exec radical ios
```

Run these commands from your app directory after completing the native setup. In remote mode, keep the app's development server running.

## Public entry points

| Import | Purpose |
| --- | --- |
| `@akshatowo/radical/vite` | Core configuration and Vite plugin |
| `@akshatowo/radical/tanstack-start` | TanStack Start Vite integration |
| `@akshatowo/radical/tanstack-start-server` | Request middleware and SSR wrappers |
| `@akshatowo/radical/tanstack-start-client` | Browser transitions and router adapter |
| `@akshatowo/radical/react` | Provider and React hooks |
| `@akshatowo/radical/client` | Client Effects, services, and browser layers |
| `@akshatowo/radical/server` | Server native-context reader |
| `@akshatowo/radical/plugins` | Custom plugin manifests and typed clients |

See [next steps](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/getting-started/next-steps.mdx) for capabilities, offline routes, app assets, and production delivery. The [API reference](https://github.com/akshat-OwO/radical/tree/main/apps/docs/content/docs/reference) describes options, exports, and typed errors.
