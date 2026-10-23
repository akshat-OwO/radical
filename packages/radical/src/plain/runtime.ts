import { Effect, Layer, ManagedRuntime } from "effect";

import type { Bridge } from "../core/bridge/bridge.ts";
import { BridgeLive } from "../core/bridge/bridge.ts";

/** A provider-owned bridge runtime. Dispose it when its owner unmounts. */

export interface RadicalRuntime {
  readonly dispose: () => Promise<void>;
}

const runtimes = new WeakMap<
  RadicalRuntime,
  ManagedRuntime.ManagedRuntime<Bridge, never>
>();

export const createEffectRuntime = (
  layer: Layer.Layer<Bridge> = BridgeLive
): RadicalRuntime => {
  const runtime = ManagedRuntime.make(layer);
  const handle: RadicalRuntime = { dispose: runtime.dispose };
  runtimes.set(handle, runtime);

  return handle;
};

export const createRadicalRuntime = (): RadicalRuntime => createEffectRuntime();

/** The same managed runtime used by Plain API commands and React hooks. */

export const getEffectRuntime = (runtime: RadicalRuntime) => {
  const managed = runtimes.get(runtime);

  return managed ?? Effect.runSync(Effect.die("Unknown Radical runtime"));
};

export const runtimeBridgeLayer = (runtime: RadicalRuntime) =>
  Layer.effectContext(getEffectRuntime(runtime).contextEffect);

// Default standalone calls share a lazily built bridge. Providers own separate runtimes.

export const defaultRuntime = createRadicalRuntime();
