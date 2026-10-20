import { Context, Effect, Layer, Schema } from "effect";

import { BridgeCallFailed } from "./bridge-call-failed.ts";
import { BridgeDecodeError } from "./bridge-decode-error.ts";
import { BridgeUnavailable } from "./bridge-unavailable.ts";

export { BridgeUnavailable } from "./bridge-unavailable.ts";
export { BridgeCallFailed } from "./bridge-call-failed.ts";
export { BridgeDecodeError } from "./bridge-decode-error.ts";

export const RuntimeSchema = Schema.Literals(["browser", "android", "ios"]);
export type Runtime = typeof RuntimeSchema.Type;
export type BridgeError =
  | BridgeUnavailable
  | BridgeCallFailed
  | BridgeDecodeError;

/** The subset injected by Capacitor 8's native-bridge.js on both platforms. */
export interface InjectedBridge {
  readonly getPlatform: () => string;
  readonly nativePromise: (
    plugin: string,
    method: string,
    options: Readonly<Record<string, unknown>>
  ) => Promise<unknown>;
}
const injectedBridge = (): InjectedBridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as Window & { Capacitor?: InjectedBridge }).Capacitor;

/** SSR reports browser. Detection reads globals only when called. */
const runtimeOf = (bridge: InjectedBridge | undefined): Runtime => {
  const platform = bridge?.getPlatform();
  return platform === "android" || platform === "ios" ? platform : "browser";
};

export const detectRuntime = (): Runtime => runtimeOf(injectedBridge());

export class Bridge extends Context.Service<
  Bridge,
  {
    readonly runtime: Effect.Effect<Runtime>;
    /** Native events retain their latest value across page startup. */
    readonly observe: (
      event: string,
      receive: (value: unknown) => void
    ) => Effect.Effect<() => void>;
    readonly call: (
      plugin: string,
      method: string,
      options: Readonly<Record<string, unknown>>
    ) => Effect.Effect<unknown, BridgeUnavailable | BridgeCallFailed>;
  }
>()("radical/Bridge") {}

const bridgeEventListener =
  (receive: (value: unknown) => void) => (message: Event) => {
    if (message instanceof CustomEvent) {
      receive(message.detail);
    }
  };

interface ShellEvents extends EventTarget {
  readonly __radical?: { readonly latest: Record<string, unknown> };
}

/** Acquisition is lazy so importing or constructing a layer is SSR-safe. */
export const bridgeLayer = (
  read: () => InjectedBridge | undefined,
  readEvents: () => ShellEvents = () => window
) =>
  Layer.succeed(Bridge, {
    runtime: Effect.sync(() => runtimeOf(read())),
    observe: (event: string, receive: (value: unknown) => void) =>
      Effect.sync(() => {
        const events = readEvents();
        const listener = bridgeEventListener(receive);
        events.addEventListener(event, listener);
        const latest = events.__radical?.latest;
        if (latest && Object.hasOwn(latest, event)) {
          receive(latest[event]);
        }
        return () => {
          events.removeEventListener(event, listener);
        };
      }),
    call: (plugin, method, options) =>
      Effect.suspend<unknown, BridgeUnavailable | BridgeCallFailed, never>(
        () => {
          const bridge = read();
          if (
            !bridge ||
            runtimeOf(bridge) === "browser" ||
            typeof bridge.nativePromise !== "function"
          ) {
            return Effect.fail(new BridgeUnavailable({ plugin, method }));
          }
          return Effect.tryPromise({
            try: () => bridge.nativePromise(plugin, method, options),
            catch: (cause) => new BridgeCallFailed({ plugin, method, cause }),
          });
        }
      ),
  });
export const BridgeLive = bridgeLayer(injectedBridge);

/** Each test supplies its own handler and state; decoding stays on the caller side. */
export const bridgeTestLayer = (
  runtime: Runtime,
  call: Bridge["Service"]["call"],
  observe: Bridge["Service"]["observe"] = () =>
    Effect.succeed(() => {
      // Test bridges without events have nothing to release.
    })
) => Layer.succeed(Bridge, { runtime: Effect.succeed(runtime), call, observe });

/** Every capability decodes at this boundary, including with an in-memory bridge. */
export const callBridge = <A, I>(
  plugin: string,
  method: string,
  schema: Schema.Codec<A, I>,
  options: Readonly<Record<string, unknown>> = {}
) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const result = yield* bridge.call(plugin, method, options);
    return yield* Schema.decodeUnknownEffect(schema)(result).pipe(
      Effect.mapError(
        (cause) => new BridgeDecodeError({ plugin, method, cause })
      )
    );
  });
