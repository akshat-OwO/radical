import { Effect, Schema } from "effect";

import type { NativeContext } from "./native-context.ts";
import { NATIVE_CONTEXT_COOKIE, ShellContextSchema } from "./native-context.ts";

const decodeContext = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ShellContextSchema)
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

/** Read shell facts without allowing a malformed cookie to fail the request. */
export const getNativeContext = (
  request: Request
): Effect.Effect<NativeContext> =>
  Effect.suspend(() => {
    const value = readCookie(request);
    return value === undefined
      ? Effect.succeed(browserContext())
      : Effect.try(() => decodeURIComponent(value)).pipe(
          Effect.flatMap(decodeContext),
          Effect.orElseSucceed(browserContext)
        );
  });

export { safeAreaStyle } from "./native-context.ts";
export type { SafeArea } from "./native-context.ts";
