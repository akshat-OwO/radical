# <img src="apps/docs/public/favicon.svg" width="36" height="36" alt="" /> Radical

Radical runs your web app inside Android and iOS WebView shells, loaded from an HTTP origin or packaged as SPA assets. A Vite plugin generates the native projects.

The Plain API and React hooks connect your UI to native capabilities. TanStack Start is the implemented framework adapter.

## Get started

Create your own app with [Getting started](apps/docs/content/docs/getting-started/index.mdx). The [installation guide](apps/docs/content/docs/getting-started/installation.mdx) scaffolds a TanStack Start app with the TanStack CLI and adds Radical, then [native setup](apps/docs/content/docs/getting-started/native.mdx) takes the same UI to Android or iOS.

Install Radical in your app:

```sh
pnpm add @akshatowo/radical
```

The CLI command remains `radical`. Use the [project structure](apps/docs/content/docs/getting-started/project-structure.mdx) to find configuration and routes, then follow [next steps](apps/docs/content/docs/getting-started/next-steps.mdx) for device capabilities and deployment.

Read the [documentation](apps/docs/content/docs/index.mdx) for task guides, API reference, and architecture. The [example app](apps/example) demonstrates the integrations in this repository.

## Work on the documentation

The docs use Blume and Astro. In a checkout of this repository, run:

```sh
pnpm install
pnpm --filter @radical/docs dev
```

Open `http://localhost:4317` for the homepage or `/docs` for the documentation. Run `pnpm --filter @radical/docs build` to prerender every documentation page. To check the workspace, run `vp run ready`.

Readiness removes `packages/radical/dist`, runs the CLI from source to generate example plugin declarations, and checks both apps before building Radical. Workspace tsconfigs select the `@akshatowo/radical/source` export condition.

Published exports use `dist` through `publishConfig.exports`. The checks run without task caching so an existing build cannot hide a resolution regression.

The default Plain API returns values, Promises, React state, and callbacks. Install `@akshatowo/radical`; required peers install automatically with pnpm, npm 7+, and Bun. Yarn Berry users also run `yarn add effect`.

Effect API users install `effect` directly and import from `/effect/*`. Plugin authoring retains Effect Schema codecs. See the [Effect API guide](https://github.com/akshat-OwO/radical/blob/main/apps/docs/content/docs/guides/effect-api.mdx).
