import { Effect, Schema } from "effect";

import type { RadicalConfig } from "./config.ts";
import {
  NativeContextSchema,
  NATIVE_CONTEXT_HEADER,
} from "./native-context.ts";
import type { NativeContext } from "./native-context.ts";
import { safeAreaStyle } from "./safe-area-style.ts";

export const bundledOrigins = [
  "https://localhost",
  "capacitor://localhost",
] as const;

export class RequestFailed extends Schema.TaggedError<
  RequestFailed,
  { readonly brand: unique symbol }
>()("RequestFailed", { cause: Schema.Unknown }) {}

export const browserContext = (): NativeContext => ({
  platform: "browser",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  shellVersion: null,
});

interface BundledDocument {
  readonly __radicalNativeContext?: unknown;
  __radicalMounted?: boolean;
  readonly document: {
    readonly documentElement: {
      readonly style: Pick<CSSStyleDeclaration, "setProperty">;
    };
  };
}

const shellDocument = (): BundledDocument | undefined =>
  typeof window === "undefined" ? undefined : window;
const injectedNativeContext = (value: unknown) =>
  Schema.decodeUnknownEffect(NativeContextSchema)(value).pipe(
    Effect.orElseSucceed(browserContext)
  );

/** Keep prerender and hydration stable; live reads begin only after the mount handoff. */
export const localNativeContext = (
  read: () => BundledDocument | undefined = shellDocument
) =>
  Effect.suspend(() => {
    const target = read();
    return target?.__radicalMounted === true
      ? injectedNativeContext(target.__radicalNativeContext)
      : Effect.succeed(browserContext());
  });

/** Run after mount. Native CSS owns subsequent inset updates; React keeps stable style props. */
export const mountNativeContext = (
  read: () => BundledDocument | undefined = shellDocument
) =>
  Effect.gen(function* () {
    const target = read();
    const context = yield* injectedNativeContext(
      target?.__radicalNativeContext
    );
    if (target) {
      target.__radicalMounted = true;
      for (const [name, value] of Object.entries(safeAreaStyle(context))) {
        target.document.documentElement.style.setProperty(name, value);
      }
    }
    return context;
  });

/** Only local shell requests are redirected. Other origins never receive shell context. */
export const routeBundledRequest = (
  config: Pick<RadicalConfig, "mode" | "origin">,
  input: string | URL | Request,
  init: RequestInit | undefined,
  page: string,
  context: NativeContext
) =>
  Effect.try({
    try: () => {
      const source = input instanceof Request ? input.url : String(input);
      const url = new URL(source, page);
      const pageUrl = new URL(page);
      const pageOrigin = `${pageUrl.protocol}//${pageUrl.host}`;
      const local = bundledOrigins.some((origin) => pageOrigin === origin);
      const urlOrigin = `${url.protocol}//${url.host}`;
      const routed =
        config.mode === "bundled" &&
        local &&
        config.origin !== undefined &&
        (urlOrigin === pageOrigin || urlOrigin === config.origin);
      const target = routed
        ? new URL(url.pathname + url.search, config.origin).href
        : url.href;
      const request = new Request(
        target,
        input instanceof Request ? input : undefined
      );
      const result = new Request(request, init);
      if (routed) {
        result.headers.set(
          NATIVE_CONTEXT_HEADER,
          encodeURIComponent(JSON.stringify(context))
        );
        return new Request(result, { credentials: "include", mode: "cors" });
      }
      return result;
    },
    catch: (cause) => new RequestFailed({ cause }),
  });

/** Start's serverFns.fetch hook and application API calls share this fetch facade. */
export const createRadicalFetch =
  (config: Pick<RadicalConfig, "mode" | "origin">) =>
  (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* () {
        // Normal browsers and remote shells retain their normal fetch semantics.
        const page =
          typeof location === "undefined"
            ? ""
            : `${location.protocol}//${location.host}`;
        if (
          config.mode !== "bundled" ||
          !bundledOrigins.some((origin) => page === origin)
        ) {
          return yield* Effect.tryPromise({
            try: () => fetch(input, init),
            catch: (cause) => new RequestFailed({ cause }),
          });
        }
        const context = yield* injectedNativeContext(
          shellDocument()?.__radicalNativeContext
        );
        const request = yield* routeBundledRequest(
          config,
          input,
          init,
          location.href,
          context
        );
        return yield* Effect.tryPromise({
          try: () => fetch(request),
          catch: (cause) => new RequestFailed({ cause }),
        });
      })
    );
