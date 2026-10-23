---
status: accepted
---

# 0014: Plain and Effect APIs

Radical offers two public APIs from one package. The Plain API, the default, returns values, Promises, React state, and callbacks. Effect API subpaths under `@akshatowo/radical/effect/` expose the Effects, layers, and services that the plain API is built on. Some users want typed errors and composition with their own Effect programs. Others want to call native capabilities without learning Effect. Today the React hooks and Vite config are already plain, but plugin commands, the bridge layer, adapter layers, and offline registration return Effect values. Users therefore need `effect` to call a plugin command.

`effect` becomes a required peer dependency of `@akshatowo/radical` instead of a regular dependency. Radical is written in Effect, so `effect` must be installed at runtime whichever API an app uses. A peer dependency guarantees that the app and Radical share one copy, so the `Effect`, `Layer`, and error types that cross the Effect API boundary are the same types. npm 7+, pnpm 8+, and Bun install required peers automatically. Plain API users install only `@akshatowo/radical` and never import `effect`. Effect API users add `effect` to their own dependencies because they import it directly. `@effect/platform-node` stays a regular dependency because only the CLI and Vite plugin use it, and no app code receives its types.

The plain API is a thin layer over the Effect API, not a second implementation. Each plain function runs the matching Effect with the bridge layer provided. Synchronous helpers return values directly. Bridge commands, runtime disposal, notification shutdown, and service-worker registration remain asynchronous. Commands reject with the same tagged error classes, which extend `Error`, so callers can narrow with `instanceof` or `_tag`. React providers own the runtime and replace the layers that apps mount by hand today. Both APIs share one runtime per provider, so an app can mix them.

## Considered options

- **Two packages, with `effect` as a regular dependency of the plain package.** The Effect package would depend on the plain package and its `effect` copy. When the versions differ, apps would get two copies and incompatible types, which is the defect this decision removes.
- **Bundle `effect` into the plain entry points.** Apps that use both APIs would ship two Effect runtimes and two bridge states. Bundles would also grow.
- **Optional `effect` peer.** This doesn't work because Radical needs `effect` at runtime even when the app never imports it.

## Consequences

- Plain subpaths keep the current names (`/plugins`, `/client`, `/react`, `/tanstack-start-client`), and their Effect-returning exports move to `/effect/*`. This ships as the breaking 0.2.0 release, and 0.1.0 users who call plugin commands or mount layers must update their imports.
- Yarn Berry warns about missing peers instead of installing them, so its users run `yarn add effect` once.
- Getting started installs only `@akshatowo/radical`. The Effect guide adds `effect`.
- Plugin manifests keep Effect `Schema` codecs, so authoring a custom native plugin still requires `effect`. A plain authoring path, such as accepting Standard Schema validators, is a separate decision.
