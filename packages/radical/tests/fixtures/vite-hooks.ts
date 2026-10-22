/* oxlint-disable typescript/no-unsafe-type-assertion -- Minimal Vite hook context implements only the fields consumed by these plugins. */
import { assert } from "@effect/vitest";
import { Effect } from "effect";
import type { Plugin, ResolvedConfig } from "vite";

export const hookHandler = <F extends object>(
  hook: F | { readonly handler: F }
): F => ("handler" in hook ? hook.handler : hook);
export const resolvePlugin = (plugin: Plugin, base = "/app/") =>
  Effect.promise(async () => {
    const hook = plugin.configResolved;
    assert.isDefined(hook);
    const handler = hookHandler(hook);
    // SAFETY: This hook reads only root and base; it does not read its Vite context.
    await handler.call(
      {} as ThisParameterType<typeof handler>,
      { root: "/app", base } as ResolvedConfig
    );
  });
