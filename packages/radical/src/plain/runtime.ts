import { Layer, ManagedRuntime } from "effect";

import type { Bridge } from "../core/bridge/bridge.ts";
import { BridgeLive } from "../core/bridge/bridge.ts";

/** A provider-owned bridge runtime. Dispose it when its owner unmounts. */
class RuntimeHandle {
  readonly #managed: ManagedRuntime.ManagedRuntime<Bridge, never>;

  constructor(layer: Layer.Layer<Bridge>) {
    this.#managed = ManagedRuntime.make(layer);
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
