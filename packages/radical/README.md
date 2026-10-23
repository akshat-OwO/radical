# @akshatowo/radical

Run your web app inside Android and iOS WebView shells, loaded from an HTTP origin or packaged as SPA assets. Radical generates native projects from your Vite config and connects React hooks and the Plain API to device capabilities. The Vite core is framework-agnostic. TanStack Start is the only supported framework adapter today.

## Get started

Install Radical in your app:

```sh
pnpm add @akshatowo/radical@0.2.0
```

Follow [installation](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/getting-started/installation.mdx) to scaffold a TanStack Start app with the TanStack CLI and add Radical. No Radical repository clone is required.

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
| `@akshatowo/radical/client` | Plain client operations and runtime ownership |
| `@akshatowo/radical/server` | Server native-context reader |
| `@akshatowo/radical/plugins` | Custom plugin manifests and Promise clients |
| `@akshatowo/radical/effect/*` | Effects, services, layers, and schema codecs |

See [next steps](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/getting-started/next-steps.mdx) for capabilities, offline routes, app assets, and production delivery. The [API reference](https://github.com/akshat-OwO/radical/tree/main/apps/docs/content/docs/reference) describes options, exports, and typed errors.

The default Plain API returns values, Promises, React state, and callbacks. Install `@akshatowo/radical@0.2.0`; required peers install automatically with pnpm, npm 7+, and Bun. Yarn Berry users also run `yarn add effect`. Effect API users install `effect` directly and import from `/effect/*`. Plugin authoring retains Effect Schema codecs. See the [Effect API guide](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/guides/effect-api.mdx).
