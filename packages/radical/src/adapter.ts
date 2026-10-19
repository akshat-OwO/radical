import type { Effect } from "effect";
import { Context } from "effect";
import type { PluginOption } from "vite";

import type { AdapterUnavailable } from "./adapter-error.ts";
import type { RadicalConfig } from "./config.ts";
import type { NativeContext } from "./native-context.ts";

export interface RadicalCore {
  readonly config: RadicalConfig;
}

export interface RadicalRoute {
  readonly pattern: string;
  readonly offline?: boolean;
  readonly transition?: "slide" | "fade";
}

export interface RadicalNavigation {
  readonly navigate: (
    to: string,
    options?: { readonly replace?: boolean }
  ) => Effect.Effect<void, AdapterUnavailable>;
  readonly onBeforeNavigate: (
    callback: (from: string, to: string) => Effect.Effect<void>
  ) => Effect.Effect<() => void, AdapterUnavailable>;
  readonly onAfterNavigate: (
    callback: (to: string) => void
  ) => Effect.Effect<() => void, AdapterUnavailable>;
}

/** Framework-specific operations, supplied through a Layer. */
export class RadicalAdapter extends Context.Service<
  RadicalAdapter,
  {
    readonly name: string;
    readonly vite?: (core: RadicalCore) => PluginOption[];
    readonly routes: Effect.Effect<readonly RadicalRoute[], AdapterUnavailable>;
    readonly provideRequestContext: (
      get: (request: Request) => Effect.Effect<NativeContext>
    ) => Effect.Effect<unknown>;
    readonly navigation: Effect.Effect<RadicalNavigation>;
    readonly outputs: Effect.Effect<{
      readonly clientDir: string;
      readonly spaShell?: string;
    }>;
  }
>()("radical/Adapter") {}
