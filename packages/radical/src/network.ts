import { Effect, Queue, Schema, Stream } from "effect";

import { Bridge, BridgeDecodeError, BridgeUnavailable } from "./bridge.ts";
import type { BridgeError } from "./bridge.ts";
import { BrowserNetwork, BrowserNetworkLive } from "./browser-network.ts";
import { networkPlugin } from "./internal-plugins.ts";
import { NetworkStatusSchema } from "./network-schema.ts";
import type { NetworkStatus } from "./network-schema.ts";
import { createPluginClient } from "./plugins.ts";

export {
  BrowserNetwork,
  BrowserNetworkLive,
  browserNetworkLayer,
} from "./browser-network.ts";
export { NetworkStatusSchema, NetworkTypeSchema } from "./network-schema.ts";
export type { NetworkStatus, NetworkType } from "./network-schema.ts";
const native = createPluginClient(networkPlugin);

export const getNetworkStatus = Effect.gen(function* () {
  const bridge = yield* Bridge;
  return (yield* bridge.runtime) === "browser"
    ? yield* (yield* BrowserNetwork).current
    : yield* native.getStatus({});
});

/** Subscribe first; an event received during getStatus takes precedence over its stale response. */
export const watchNetworkStatus: Stream.Stream<
  NetworkStatus,
  BridgeError,
  Bridge | BrowserNetwork
> = Stream.callback<unknown, BridgeError, Bridge | BrowserNetwork>(
  (queue) =>
    Effect.gen(function* () {
      const bridge = yield* Bridge;
      let changed = false;
      const receive = (status: unknown) => {
        changed = true;
        Queue.offerUnsafe(queue, status);
      };
      if ((yield* bridge.runtime) === "browser") {
        const browser = yield* BrowserNetwork;
        yield* Effect.acquireRelease(browser.listen(receive), (remove) =>
          Effect.sync(remove)
        );
      } else {
        if (!bridge.listen) {
          return yield* new BridgeUnavailable({
            plugin: "Network",
            method: "addListener",
          });
        }
        yield* Effect.acquireRelease(
          bridge.listen("Network", "networkStatusChange", receive),
          (remove) => remove
        ).pipe(Effect.asVoid);
      }
      const initial = yield* getNetworkStatus;
      if (!changed) {
        Queue.offerUnsafe(queue, initial);
      }
      return yield* Effect.void;
    }),
  { bufferSize: 1, strategy: "sliding" }
).pipe(
  Stream.mapEffect((value) =>
    Schema.decodeUnknownEffect(NetworkStatusSchema)(value).pipe(
      Effect.mapError(
        (cause) =>
          new BridgeDecodeError({
            plugin: "Network",
            method: "networkStatusChange",
            cause,
          })
      )
    )
  ),
  Stream.changesWith(
    (a, b) =>
      a.connected === b.connected && a.connectionType === b.connectionType
  )
);

export const networkLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserNetwork>
) => effect.pipe(Effect.provide(BrowserNetworkLive));
