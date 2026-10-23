import { Effect } from "effect";

import { encodeNativeContextCookie as encodeCookie } from "../core/context/native-context.ts";
import type { ShellContext } from "../core/context/native-context.ts";

export type {
  SafeArea,
  NativeContext,
  ShellContext,
} from "../core/context/native-context.ts";

export {
  NATIVE_CONTEXT_HEADER,
  NATIVE_CONTEXT_COOKIE,
  safeAreaStyle,
  zeroSafeArea,
} from "../core/context/native-context.ts";

export const encodeNativeContextCookie = (
  context: ShellContext
): Promise<string> => Effect.runPromise(encodeCookie(context));
