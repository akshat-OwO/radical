import { Context, Effect, Layer, Predicate, Schema } from "effect";

import {
  BridgeCallFailed,
  BridgeDecodeError,
  BridgeUnavailable,
} from "./errors.ts";

export { BridgeUnavailable } from "./errors.ts";

export { BridgeCallFailed } from "./errors.ts";

export { BridgeDecodeError } from "./errors.ts";

export const RuntimeSchema = Schema.Literals(["browser", "android", "ios"]);

export type Runtime = typeof RuntimeSchema.Type;

export type BridgeError =
  | BridgeUnavailable
  | BridgeCallFailed
  | BridgeDecodeError;

/** The subset injected by Capacitor 8's native-bridge.js on both platforms. */
export interface InjectedBridge {
  readonly getPlatform: () => string;
  readonly convertFileSrc?: (path: string) => string;
  readonly nativeCallback?: (
    plugin: string,
    method: string,
    options: Readonly<Record<string, unknown>>,
    callback?: (value: unknown, error?: unknown) => void
  ) => string;
  readonly nativePromise: (
    plugin: string,
    method: string,
    options: Readonly<Record<string, unknown>>
  ) => Promise<unknown>;
}

interface BridgeWindow extends Window {
  readonly Capacitor?: InjectedBridge;
}

export const injectedBridge = (): InjectedBridge | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const browserWindow: BridgeWindow = window;

  return browserWindow.Capacitor;
};

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
    readonly listen?: (
      plugin: string,
      event: string,
      receive: (value: unknown) => void
    ) => Effect.Effect<
      Effect.Effect<void>,
      BridgeUnavailable | BridgeCallFailed
    >;
    /** Callback-returning native methods use their callback id as the release key. */
    readonly subscribe?: <A, I>(
      plugin: string,
      method: string,
      options: Readonly<Record<string, unknown>>,
      schema: Schema.Codec<A, I>,
      receive: (result: Effect.Effect<A, BridgeError>) => void,
      release: { readonly method: string; readonly key: string }
    ) => Effect.Effect<
      Effect.Effect<void>,
      BridgeUnavailable | BridgeCallFailed
    >;
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
    listen: (plugin, event, receive) =>
      Effect.suspend<
        Effect.Effect<void>,
        BridgeUnavailable | BridgeCallFailed,
        never
      >(() => {
        const bridge = read();

        if (!bridge?.nativeCallback) {
          return Effect.fail(
            new BridgeUnavailable({ plugin, method: "addListener" })
          );
        }

        let active = true;

        return Effect.try({
          try: () =>
            bridge.nativeCallback?.(
              plugin,
              "addListener",
              { eventName: event },
              (value, error) => {
                if (active && error === undefined) {
                  receive(value);
                }
              }
            ),
          catch: (cause) =>
            new BridgeCallFailed({ plugin, method: "addListener", cause }),
        }).pipe(
          Effect.map((callbackId) =>
            Effect.sync(() => {
              active = false;
              // Capacitor declares removeListener RETURN_NONE; it never resolves a nativePromise.
              bridge.nativeCallback?.(plugin, "removeListener", {
                eventName: event,
                callbackId,
              });
            })
          )
        );
      }),
    subscribe: (plugin, method, options, schema, receive, release) =>
      Effect.suspend<
        Effect.Effect<void>,
        BridgeUnavailable | BridgeCallFailed,
        never
      >(() => {
        const bridge = read();

        if (!bridge?.nativeCallback || runtimeOf(bridge) === "browser") {
          return Effect.fail(new BridgeUnavailable({ plugin, method }));
        }

        let active = true;
        let callbackId: string | undefined;

        const clear = () => {
          bridge.nativeCallback?.(plugin, release.method, {
            [release.key]: callbackId,
          });
        };

        return Effect.try({
          try: () =>
            bridge.nativeCallback?.(plugin, method, options, (value, error) => {
              if (!active) {
                // A permission dialog can finish native acquisition after the first clear.
                clear();

                return;
              }

              receive(
                error === undefined
                  ? Schema.decodeUnknownEffect(schema)(value).pipe(
                      Effect.mapError(
                        (cause) =>
                          new BridgeDecodeError({ plugin, method, cause })
                      )
                    )
                  : Effect.fail(
                      new BridgeCallFailed({ plugin, method, cause: error })
                    )
              );
            }),
          catch: (cause) => new BridgeCallFailed({ plugin, method, cause }),
        }).pipe(
          Effect.map((id) => {
            callbackId = id;

            return Effect.sync(() => {
              active = false;
              // clearWatch accepts the native callback id, not a promise result.
              clear();
            });
          })
        );
      }),
    call: (plugin, method, options) =>
      Effect.suspend<unknown, BridgeUnavailable | BridgeCallFailed, never>(
        () => {
          const bridge = read();

          if (
            !bridge ||
            runtimeOf(bridge) === "browser" ||
            !Predicate.isFunction(bridge.nativePromise)
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
