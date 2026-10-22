import { Effect, Schema } from "effect";

import type { PluginManifest } from "../../core/plugins/plugins.ts";
import { InvalidPlugin } from "./errors.ts";

/** The only decoding boundary for enabled plugin options. */
export const decodePluginOptions = (
  manifest: PluginManifest,
  options: Readonly<Record<string, unknown>>
) => {
  const { config } = manifest;
  if (!config) {
    return Effect.void;
  }
  const value = options[config.selector];
  if (!Object.hasOwn(options, config.selector) || value === undefined) {
    return Effect.fail(
      new InvalidPlugin({
        message: `Plugin ${manifest.id}: config selector ${config.selector} does not resolve`,
      })
    );
  }
  return Schema.decodeUnknownEffect(config.schema)(value).pipe(
    Effect.mapError(
      (error) =>
        new InvalidPlugin({
          message: `Plugin ${manifest.id} config ${config.selector}: ${error.message}`,
        })
    )
  );
};
