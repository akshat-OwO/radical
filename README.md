# Radical

Radical runs server-rendered web apps inside Android and iOS WebView shells. A Vite plugin generates the native projects. Effect APIs and React hooks connect your UI to native capabilities. TanStack Start is the implemented framework adapter.

## Get started

Create your own app with [Getting started](apps/docs/content/docs/getting-started/index.mdx). The [installation guide](apps/docs/content/docs/getting-started/installation.mdx) includes every file needed for a standalone TanStack Start project, then [native setup](apps/docs/content/docs/getting-started/native.mdx) takes the same UI to Android or iOS.

Install Radical in your app:

```sh
pnpm add @akshatowo/radical
```

The CLI command remains `radical`. Use the [project structure](apps/docs/content/docs/getting-started/project-structure.mdx) to find configuration and routes, then follow [next steps](apps/docs/content/docs/getting-started/next-steps.mdx) for device capabilities and deployment.

Read the [documentation](apps/docs/content/docs/index.mdx) for task guides, API reference, and architecture. The [example app](apps/example) demonstrates the integrations in this repository.

## Work on the documentation

The docs use Next.js and Fumadocs. In a checkout of this repository, run:

```sh
pnpm install
pnpm --filter @radical/docs dev
```

Open `http://localhost:4317/docs`. Run `pnpm --filter @radical/docs build` to prerender every documentation page. To check the workspace, run `vp run ready`.
