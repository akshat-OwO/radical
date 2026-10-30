# Bridge and device info

`@akshatowo/radical/client` exports `Bridge`, an Effect service with these operations:

- `runtime: Effect<"browser" | "android" | "ios">` detects the injected shell bridge when executed. Server execution reports `"browser"`.
- `observe(event, receive): Effect<() => void>` subscribes to shell events after mount and returns a cleanup function. The live bridge replays the latest value for each event name.
- `call(plugin, method, options): Effect<unknown, BridgeUnavailable | BridgeCallFailed>` calls Capacitor 8's injected `nativePromise`. It does not import `@capacitor/core`.

`callBridge(plugin, method, schema, options?)` decodes a call's result with the supplied Schema. It requires `Bridge` and adds `BridgeDecodeError` to the error channel. `BridgeCallFailed` preserves the native rejection as `cause`. `BridgeDecodeError` preserves the Schema failure as `cause`. Each error includes `plugin` and `method`.

Provide `BridgeLive` for the shell transport or `bridgeTestLayer(runtime, handler)` for an in-memory transport. Both use the same decoding boundary. `bridgeLayer(readInjectedBridge)` supplies a custom bridge acquisition function without reading globals at construction time.

```ts
import {
  BridgeLive,
  callBridge,
  DeviceInfoSchema,
} from "@akshatowo/radical/client";
import { Effect } from "effect";

const device = callBridge("Device", "getInfo", DeviceInfoSchema).pipe(
  Effect.provide(BridgeLive)
);
```

`detectRuntime()` is a synchronous, SSR-safe detector. `getDeviceInfo` is an Effect that requires `Bridge`. It calls the official Device native plugin on Android and iOS, and reads browser APIs otherwise.

## React state

`useDeviceInfo()` in `@akshatowo/radical/react` returns one of these states:

- `{ loading: true, value: undefined, error: undefined }`
- `{ loading: false, value: DeviceInfo, error: undefined }`
- `{ loading: false, value: undefined, error: BridgeError }`

Rendering, including server rendering, returns the initial loading state without reading browser APIs or executing the bridge. After mount, an effect loads the device info. Unmount interrupts the Effect and ignores late results. Hooks use `BridgeLive` by default, without a provider. `RadicalProvider` accepts an optional `layer: Layer<Bridge>` for all hooks in its subtree and defaults to `BridgeLive`. Keep custom layers outside components or memoize them. Provider re-renders preserve the layer identity; replacing the layer interrupts the previous load and starts another.

```tsx
import { RadicalProvider } from "@akshatowo/radical/react";

<RadicalProvider layer={testBridgeLayer}>
  <App />
</RadicalProvider>;
```

The internal `useBridgeEffect<A, E>` owns loading state, Effect execution, and interruption for capability hooks. It is not exported from `@akshatowo/radical/react`.

`DeviceInfoSchema` defines the shared result with `platform`, `model`, `operatingSystem`, `osVersion`, `manufacturer`, and `isVirtual`. The native plugin reports `platform` as `"android"` or `"ios"`; browsers report `"web"`. Operating systems are `"android"`, `"ios"`, `"windows"`, `"mac"`, `"linux"`, or `"unknown"`.

The browser fallback prefers `navigator.userAgentData.platform`, then parses known OS tokens from `navigator.userAgent`. Browser model and manufacturer remain `"unknown"`. With client hints, the OS version remains `"unknown"` because a reduced UA can report a frozen version. Without client hints, the version is a UA observation, not a verified OS version. Browser `isVirtual` defaults to `false`; browsers cannot reliably detect emulators.

## Generated shells

Shell generation includes `@capacitor/device` in the generated package's dependencies and links each required Capacitor package explicitly. Each dependency declares the exact version read from its resolved package.json. Capacitor discovers native plugins from those dependencies during `cap add` and sync. The inclusion list lives in `native-project.ts` until native plugin manifests are implemented in #13.

Safe-area hooks also accept SSR context through the provider. See [Safe area](../safe-area.md) for CSS properties, first-request behavior, and scoped subscriptions.
