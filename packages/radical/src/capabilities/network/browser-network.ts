import { Context, Effect, Layer, Schema } from "effect";

import { NetworkTypeSchema } from "./network-schema.ts";
import type { NetworkStatus } from "./network-schema.ts";

export class BrowserNetwork extends Context.Service<
  BrowserNetwork,
  {
    readonly current: Effect.Effect<NetworkStatus>;
    readonly listen: (
      receive: (status: NetworkStatus) => void
    ) => Effect.Effect<() => void>;
  }
>()("radical/BrowserNetwork") {}

export interface NetworkEnvironment {
  readonly events: EventTarget;
  readonly navigator: {
    readonly onLine: boolean;
    readonly connection?: EventTarget & { readonly type?: string };
  };
}

const readStatus = (
  navigator: NetworkEnvironment["navigator"]
): NetworkStatus => {
  const type = navigator.connection?.type;
  let connectionType: NetworkStatus["connectionType"] = "none";

  if (navigator.onLine) {
    connectionType = Schema.is(NetworkTypeSchema)(type) ? type : "unknown";
  }

  return { connected: navigator.onLine, connectionType };
};

/** Read globals only after mount. The injected environment also supports browser tests. */
export const browserNetworkLayer = (read: () => NetworkEnvironment) => {
  const current = Effect.sync(() => readStatus(read().navigator));

  return Layer.succeed(BrowserNetwork, {
    current,
    listen: (receive) =>
      Effect.sync(() => {
        const { events, navigator } = read();

        const changed = () => {
          receive(readStatus(navigator));
        };

        events.addEventListener("online", changed);
        events.addEventListener("offline", changed);
        navigator.connection?.addEventListener("change", changed);

        return () => {
          events.removeEventListener("online", changed);
          events.removeEventListener("offline", changed);
          navigator.connection?.removeEventListener("change", changed);
        };
      }),
  });
};

export const BrowserNetworkLive = browserNetworkLayer(() => ({
  events: window,
  navigator,
}));
