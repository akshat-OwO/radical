import { Layer, ManagedRuntime } from "effect";

import { BrowserLocationLive } from "../capabilities/location/browser-location.ts";
import { LocationPermissionEventsLive } from "../capabilities/location/location-permission-events-live.ts";
import type { LocationPermissionEvents } from "../capabilities/location/location-permission-events.ts";
import type { LocationWatchPool } from "../capabilities/location/location-pool.ts";
import { LocationWatchPoolLive } from "../capabilities/location/location-pool.ts";
import type { Bridge } from "../core/bridge/bridge.ts";
import { BridgeLive } from "../core/bridge/bridge.ts";

/** A provider-owned bridge runtime. Dispose it when its owner unmounts. */
class RuntimeHandle {
  readonly #managed: ManagedRuntime.ManagedRuntime<
    Bridge | LocationWatchPool | LocationPermissionEvents,
    never
  >;

  constructor(layer: Layer.Layer<Bridge>) {
    const permissionEvents = LocationPermissionEventsLive.pipe(
      Layer.provide(layer)
    );

    this.#managed = ManagedRuntime.make(
      Layer.mergeAll(
        layer,
        permissionEvents,
        LocationWatchPoolLive.pipe(
          Layer.provide(
            Layer.mergeAll(layer, BrowserLocationLive, permissionEvents)
          )
        )
      )
    );
  }

  readonly dispose = (): Promise<void> => this.#managed.dispose();

  static managed(runtime: RuntimeHandle) {
    return runtime.#managed;
  }
}

export type RadicalRuntime = RuntimeHandle;

export const createEffectRuntime = (
  layer: Layer.Layer<Bridge> = BridgeLive
): RadicalRuntime => new RuntimeHandle(layer);

export const createRadicalRuntime = (): RadicalRuntime => createEffectRuntime();

/** The same managed runtime used by Plain API commands and React hooks. */
export const getEffectRuntime = (runtime: RadicalRuntime) =>
  RuntimeHandle.managed(runtime);

export const runtimeBridgeLayer = (runtime: RadicalRuntime) =>
  Layer.effectContext(getEffectRuntime(runtime).contextEffect);

// Default standalone calls share a lazily built bridge. Providers own separate runtimes.

export const defaultRuntime = createRadicalRuntime();
