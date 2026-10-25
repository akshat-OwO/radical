import { Option, Schema } from "effect";

import { ShellContextSchema } from "./native-context.ts";

const decodeShellDocument = Schema.decodeUnknownOption(
  Schema.Struct({ __radicalNativeContext: ShellContextSchema })
);

/** Read only after hydration or mount; SSR uses the request's provider context. */
export const nativeSectionBar = (fallback: boolean) =>
  Option.match(decodeShellDocument(globalThis), {
    onNone: () => fallback,
    onSome: (document) =>
      document.__radicalNativeContext.nativeSectionBar ?? fallback,
  });
