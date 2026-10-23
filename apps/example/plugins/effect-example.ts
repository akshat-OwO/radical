import type { RadicalRuntime } from "@akshatowo/radical/client";
import { getEffectRuntime } from "@akshatowo/radical/effect/client";
import { createPluginClient } from "@akshatowo/radical/effect/plugins";
import { Effect } from "effect";

import echo from "./echo.ts";

/** Compose typed commands in the same runtime supplied to RadicalProvider. */
export const echoWithEffect = async (runtime: RadicalRuntime, text: string) =>
  await getEffectRuntime(runtime).runPromise(
    createPluginClient(echo)
      .echo({ text })
      .pipe(Effect.map((result) => result.text))
  );
