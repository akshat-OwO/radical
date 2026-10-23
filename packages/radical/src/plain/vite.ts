import type { RadicalConfig } from "../vite/config.ts";
import { radical as effectRadical } from "../vite/vite.ts";

export type { RadicalConfig } from "../vite/config.ts";

export { InvalidConfig } from "../vite/config.ts";

export {
  InvalidPlugin,
  PluginDependencyConflict,
} from "../vite/plugins/errors.ts";

export const radical = (config: RadicalConfig) => effectRadical(config);
