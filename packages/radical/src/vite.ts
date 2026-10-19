import { Effect } from "effect";
import type { Plugin } from "vite";

import type { RadicalConfig } from "./config.ts";
import { validateConfig } from "./config.ts";

export { AdapterUnavailable } from "./adapter-error.ts";
export { RadicalAdapter } from "./adapter.ts";
export type {
  RadicalCore,
  RadicalNavigation,
  RadicalRoute,
} from "./adapter.ts";
export {
  InvalidConfig,
  RadicalConfigSchema,
  validateConfig,
} from "./config.ts";

export type { RadicalConfig } from "./config.ts";

/** Validate at Vite's config hook, before either dev or build starts. */
export const radical = (config: RadicalConfig): Plugin => ({
  name: "radical:config",
  config: () => Effect.runPromise(validateConfig(config).pipe(Effect.asVoid)),
});
