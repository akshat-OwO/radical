import { Effect, Schema } from "effect";

import type { NativeContext } from "./native-context.ts";
import { NATIVE_CONTEXT_HEADER, ShellContextSchema } from "./native-context.ts";

const decodeHeader = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ShellContextSchema)
);

const browserContext = (): NativeContext => ({
  platform: "browser",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  shellVersion: null,
});

/** Read shell facts without allowing a malformed header to fail the request. */
export const getNativeContext = (
  request: Request
): Effect.Effect<NativeContext> =>
  Effect.suspend(() => {
    const header = request.headers.get(NATIVE_CONTEXT_HEADER);
    return header === null
      ? Effect.succeed(browserContext())
      : decodeHeader(header).pipe(
          Effect.catchTag("SchemaError", () => Effect.succeed(browserContext()))
        );
  });
