import { Effect, Schema } from "effect";

export const shouldRegister = (context: {
  readonly production: boolean;
  readonly browser: boolean;
  readonly shell: boolean;
}) => context.production && context.browser && !context.shell;

export class ServiceWorkerRegistrationError extends Schema.TaggedError<
  ServiceWorkerRegistrationError,
  { readonly brand: unique symbol }
>()("ServiceWorkerRegistrationError", { cause: Schema.Unknown }) {}

export const registerOfflineEffect = (options: {
  readonly production: boolean;
  /** Serialize this flag from the server native context. */
  readonly shell: boolean;
  readonly base?: string;
}) =>
  Effect.suspend(() => {
    const browser =
      typeof window !== "undefined" && typeof navigator !== "undefined";
    if (
      !shouldRegister({
        production: options.production,
        browser,
        shell: options.shell,
      }) ||
      !("serviceWorker" in navigator)
    ) {
      return Effect.void;
    }
    const base = options.base ?? "/";
    return Effect.tryPromise({
      try: () =>
        navigator.serviceWorker.register(`${base}radical-sw.js`, {
          scope: base,
        }),
      catch: (cause) => new ServiceWorkerRegistrationError({ cause }),
    }).pipe(Effect.asVoid);
  });

/** Promise facade for app lifecycle hooks; Effect remains available separately. */
export const registerOffline = (
  options: Parameters<typeof registerOfflineEffect>[0]
) => Effect.runPromise(registerOfflineEffect(options));

export {
  BrowserTransitions,
  BrowserTransitionsLive,
  cancelBrowserTransition,
  watchBrowserTransition,
  TransitionSchema,
  TransitionFailed,
} from "./browser-transitions.ts";
export type { BrowserTransition, Transition } from "./browser-transitions.ts";

export {
  Bridge,
  BridgeLive,
  bridgeLayer,
  bridgeTestLayer,
  callBridge,
  detectRuntime,
  RuntimeSchema,
  BridgeUnavailable,
  BridgeCallFailed,
  BridgeDecodeError,
} from "./bridge.ts";
export type { BridgeError, InjectedBridge, Runtime } from "./bridge.ts";
export {
  DeviceInfoSchema,
  browserDeviceInfo,
  getDeviceInfo,
} from "./device-info.ts";
export type { DeviceInfo } from "./device-info.ts";

export { safeAreaStyle } from "./native-context.ts";
export type { SafeArea } from "./native-context.ts";
export { syncSafeArea, watchSafeArea } from "./safe-area.ts";
