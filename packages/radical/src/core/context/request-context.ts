import { Effect, Schema } from "effect";

import { browserContext } from "./browser-context.ts";
import type { NativeContext } from "./native-context.ts";
import {
  NATIVE_CONTEXT_COOKIE,
  NATIVE_CONTEXT_HEADER,
  NativeContextSchema,
} from "./native-context.ts";

const decodeContext = Schema.decodeUnknownEffect(
  Schema.fromJsonString(NativeContextSchema)
);

const readCookie = (request: Request) => {
  const prefix = `${NATIVE_CONTEXT_COOKIE}=`;

  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
};

/** Read header or cookie shell facts without allowing malformed input to fail the request. */
export const getNativeContext = (
  request: Request
): Effect.Effect<NativeContext> =>
  Effect.suspend(() => {
    const value =
      request.headers.get(NATIVE_CONTEXT_HEADER) ?? readCookie(request);

    return value === undefined
      ? Effect.succeed(browserContext())
      : Effect.try(() => decodeURIComponent(value)).pipe(
          Effect.flatMap(decodeContext),
          Effect.orElseSucceed(browserContext)
        );
  });
