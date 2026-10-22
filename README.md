# Radical

Radical runs server-rendered web apps inside Android and iOS WebView shells. A Vite plugin generates the native projects. Effect APIs and React hooks connect your UI to native capabilities. TanStack Start is the implemented framework adapter.

Read the [Radical documentation](apps/docs/content/docs/index.mdx) for the introduction, tutorial, task guides, API reference, and explanations. The [example app](apps/example) is a working consumer.

For bundled TanStack Start apps, import `withBundledRequests` from `radical/tanstack-start-server` so API responses expose Start's protocol headers. See [Switch to bundled mode](apps/docs/content/docs/guides/bundled-mode.mdx).

To run the docs locally:

```sh
pnpm install
vp -C apps/docs dev
```

Open `http://localhost:4317/docs`. To check the workspace, run `vp run ready`.
