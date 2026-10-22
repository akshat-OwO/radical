import { Context, Effect, Layer, Schema } from "effect";

import { Bridge, BridgeDecodeError } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import { dataProtectionPlugin } from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import { clearBrowserWebData } from "./browser-web-data.ts";
import type {
  DataProtectionStatus,
  WebDataClearFailed,
} from "./data-protection-schema.ts";

export {
  DataProtectionStatusSchema,
  WebDataClearFailed,
} from "./data-protection-schema.ts";
export type { DataProtectionStatus } from "./data-protection-schema.ts";
export type DataProtectionError = BridgeError | WebDataClearFailed;

export class BrowserDataProtection extends Context.Service<
  BrowserDataProtection,
  {
    readonly clear: Effect.Effect<void, WebDataClearFailed>;
  }
>()("radical/BrowserDataProtection") {}

export const BrowserDataProtectionLive = Layer.succeed(BrowserDataProtection, {
  clear: clearBrowserWebData(() => ({
    get localStorage() {
      return window.localStorage;
    },
    get sessionStorage() {
      return window.sessionStorage;
    },
    disableSnapshots: () => {
      Object.assign(window, { __radicalDataCleared: true });
    },
    document,
    location,
    get caches() {
      return globalThis.caches;
    },
    get indexedDB() {
      return globalThis.indexedDB;
    },
    get serviceWorker() {
      return navigator.serviceWorker;
    },
  })),
});

export const setDataProtection = (enabled: boolean) =>
  Effect.gen(function* () {
    const value = yield* Schema.decodeEffect(Schema.Boolean)(enabled).pipe(
      Effect.mapError(
        (cause) =>
          new BridgeDecodeError({
            plugin: dataProtectionPlugin.bridge,
            method: "setProtection",
            cause,
          })
      )
    );
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      return {
        enabled: false,
        screenshots: false,
        recording: false,
        appSwitcher: false,
      } satisfies DataProtectionStatus;
    }
    return yield* callPlugin(
      dataProtectionPlugin.bridge,
      "setProtection",
      dataProtectionPlugin.commands.setProtection,
      { enabled: value }
    );
  });

/** Destructive. Close database connections and stop application writes first. */
export const clearWebData = Effect.gen(function* () {
  const browser = yield* BrowserDataProtection;
  yield* browser.clear;
  const bridge = yield* Bridge;
  if ((yield* bridge.runtime) !== "browser") {
    yield* callPlugin(
      dataProtectionPlugin.bridge,
      "clearWebData",
      dataProtectionPlugin.commands.clearWebData,
      {}
    );
  }
});
export const dataProtectionLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserDataProtection>
) => effect.pipe(Effect.provide(BrowserDataProtectionLive));
