import { Effect, Predicate } from "effect";

import { injectedBridge } from "./bridge/bridge.ts";
import { Unavailable } from "./errors.ts";

const unavailable = (cause: unknown) =>
  new Unavailable({ reason: String(cause) });

/** Reads a native file URI through Capacitor's local file URL, aborting the fetch on interruption. */
export const readNativeFile = (uri: string) =>
  Effect.suspend(() => {
    const convert = injectedBridge()?.convertFileSrc;

    if (!Predicate.isFunction(convert)) {
      return Effect.fail(unavailable("Native file URLs require Capacitor"));
    }

    const controller = new AbortController();

    return Effect.try({ try: () => convert(uri), catch: unavailable }).pipe(
      Effect.flatMap((url) =>
        Effect.tryPromise({
          try: () => fetch(url, { signal: controller.signal }),
          catch: unavailable,
        })
      ),
      Effect.flatMap((response) =>
        response.ok
          ? Effect.tryPromise({
              try: () => response.blob(),
              catch: unavailable,
            })
          : Effect.fail(unavailable(`File read failed: ${response.status}`))
      ),
      Effect.ensuring(
        Effect.sync(() => {
          controller.abort();
        })
      )
    );
  });
