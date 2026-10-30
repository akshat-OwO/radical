import { Context, Effect, Layer, Schema, flow } from "effect";

import { safeAreaStyle } from "../../capabilities/safe-area/safe-area-style.ts";
import { windowLayoutStyle } from "../../capabilities/window-layout/window-layout-style.ts";
import type { RadicalConfig } from "../../vite/config.ts";
import { browserContext } from "../context/browser-context.ts";
import {
  NativeContextSchema,
  NATIVE_CONTEXT_HEADER,
} from "../context/native-context.ts";
import type { NativeContext } from "../context/native-context.ts";
import { appUpdateStore } from "../update/app-update.ts";
import type { AppUpdateStore } from "../update/app-update.ts";
import { receiveAppUpdate } from "../update/update-client.ts";
import { RequestFailed } from "./request-error.ts";

export { RequestFailed } from "./request-error.ts";

export { browserContext } from "../context/browser-context.ts";

export const bundledOrigins = [
  "https://localhost",
  "capacitor://localhost",
] as const;

/** WebKit reports `capacitor://localhost` without a trailing slash, so compare origins, not prefixes. */
const isBundledPage = (page: string) => {
  if (!URL.canParse(page)) {
    return false;
  }

  const { protocol, host } = new URL(page);

  return bundledOrigins.some((origin) => `${protocol}//${host}` === origin);
};

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

const injectedNativeContext = flow(
  Schema.decodeUnknownEffect(NativeContextSchema),
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

      for (const [name, value] of Object.entries({
        ...safeAreaStyle(context),
        ...windowLayoutStyle(context),
      })) {
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
      const local = isBundledPage(page);
      const pageUrl = new URL(page);
      const pageOrigin = `${pageUrl.protocol}//${pageUrl.host}`;
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

/** In-memory transports let callers test routing and update handling without a network. */
export class RadicalFetchEnvironment extends Context.Service<
  RadicalFetchEnvironment,
  {
    readonly page: Effect.Effect<string>;
    readonly context: Effect.Effect<NativeContext>;
    readonly fetch: (
      input: string | URL | Request,
      init?: RequestInit
    ) => Effect.Effect<Response, RequestFailed>;
  }
>()("radical/RadicalFetchEnvironment") {}

export const RadicalFetchEnvironmentLive = Layer.succeed(
  RadicalFetchEnvironment,
  {
    page: Effect.sync(() =>
      typeof location === "undefined" ? "" : location.href
    ),
    context: Effect.suspend(() =>
      injectedNativeContext(shellDocument()?.__radicalNativeContext)
    ),
    fetch: (input, init) =>
      Effect.tryPromise({
        try: () => fetch(input, init),
        catch: (cause) => new RequestFailed({ cause }),
      }),
  }
);

/** Effect API for Start's fetch hook and application API calls. */
export const radicalFetch = (
  config: Pick<RadicalConfig, "mode" | "origin">,
  input: string | URL | Request,
  init?: RequestInit,
  store: AppUpdateStore = appUpdateStore
) =>
  Effect.gen(function* () {
    const environment = yield* RadicalFetchEnvironment;
    const page = yield* environment.page;

    const local = isBundledPage(page);

    if (config.mode !== "bundled" || !local) {
      return yield* environment.fetch(input, init);
    }

    const request = yield* routeBundledRequest(
      config,
      input,
      init,
      page,
      yield* environment.context
    );

    const response = yield* environment.fetch(request);

    // Only responses from the configured app origin may change the update state.
    if (
      response.status === 426 &&
      new URL(request.url).origin === config.origin
    ) {
      yield* receiveAppUpdate(response, store).pipe(Effect.ignore);
    }

    return response;
  });

/** Plain fetch facade; the implementation is shared with the Effect API. */
export const createRadicalFetch =
  (
    config: Pick<RadicalConfig, "mode" | "origin">,
    store: AppUpdateStore = appUpdateStore
  ) =>
  (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    Effect.runPromise(
      radicalFetch(config, input, init, store).pipe(
        Effect.provide(RadicalFetchEnvironmentLive)
      )
    );
