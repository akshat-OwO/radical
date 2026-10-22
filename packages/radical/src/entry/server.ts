import { Effect, Schema } from "effect";

import type { NativeContext } from "../core/context/native-context.ts";
import {
  NATIVE_CONTEXT_COOKIE,
  NATIVE_CONTEXT_HEADER,
  NativeContextSchema,
} from "../core/context/native-context.ts";

const decodeContext = Schema.decodeUnknownEffect(
  Schema.fromJsonString(NativeContextSchema)
);

const browserContext = (): NativeContext => ({
  platform: "browser",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  shellVersion: null,
});

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

export { safeAreaStyle } from "../core/context/native-context.ts";
export type { SafeArea } from "../core/context/native-context.ts";

export { withBundledRequests } from "../core/bundled/bundled-server.ts";
