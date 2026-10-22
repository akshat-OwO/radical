/* oxlint-disable typescript/no-unsafe-type-assertion -- Minimal Vite hook context implements only the fields consumed by these plugins. */
import { assert } from "@effect/vitest";
import { Effect } from "effect";
import type { Plugin, ResolvedConfig } from "vite";

export const resolvePlugin = (plugin: Plugin, base = "/app/") =>
  Effect.promise(async () => {
    const hook = plugin.configResolved;
    assert.isDefined(hook);
    const handler = typeof hook === "function" ? hook : hook.handler;
    await handler.call(
      {} as ThisParameterType<typeof handler>,
      { root: "/app", base } as ResolvedConfig
    );
  });
