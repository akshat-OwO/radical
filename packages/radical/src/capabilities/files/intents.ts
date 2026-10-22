import { Context, Effect, Layer, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import { Unavailable } from "../../core/errors.ts";
import {
  appLauncherPlugin,
  fileOpenerPlugin,
} from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import { NoHandler } from "./errors.ts";

export { NoHandler } from "./errors.ts";
export type IntentError = NoHandler | Unavailable | BridgeError;
export interface OpenFileOptions {
  /** Show the system chooser (Android) or Open In menu (iOS) instead of the default handler. */
  readonly chooser?: boolean;
}
export interface OpenableFile {
  readonly uri?: string;
  readonly mimeType?: string;
}

/** Browser navigation is isolated so tests never open real windows. */
export class BrowserIntents extends Context.Service<
  BrowserIntents,
  { readonly openUrl: (url: string) => Effect.Effect<void, Unavailable> }
>()("radical/BrowserIntents") {}

export const BrowserIntentsLive = Layer.succeed(BrowserIntents, {
  openUrl: (url) =>
    Effect.suspend(() => {
      if (typeof window === "undefined") {
        return Effect.fail(
          new Unavailable({ reason: "Opening URLs requires a browser" })
        );
      }
      // noopener makes window.open return null, so a blocked popup cannot be detected.
      window.open(url, "_blank", "noopener,noreferrer");
      return Effect.void;
    }),
});

const parse = (url: string) =>
  URL.canParse(url)
    ? Effect.succeed(url)
    : Effect.fail(new Unavailable({ reason: `Invalid URL: ${url}` }));

/** Opens a URL in the app that handles it, such as the browser, mail, or maps. */
export const openUrl = (url: string) =>
  Effect.gen(function* () {
    const target = yield* parse(url);
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      const browser = yield* BrowserIntents;
      return yield* browser.openUrl(target);
    }
    const { completed } = yield* callPlugin(
      appLauncherPlugin.bridge,
      "openUrl",
      appLauncherPlugin.commands.openUrl,
      { url: target }
    );
    return yield* completed
      ? Effect.void
      : Effect.fail(new NoHandler({ target }));
  });

/** Opens a native file in an external app. Browser files have no URI and fail with Unavailable. */
const hasErrorCode = Schema.is(Schema.Struct({ code: Schema.Unknown }));
export const openFile = (file: OpenableFile, options: OpenFileOptions = {}) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser" || file.uri === undefined) {
      return yield* new Unavailable({
        reason: "Only files picked in a native shell can be opened externally",
      });
    }
    const target = file.uri;
    const args: OpenFileArgs = {
      filePath: target,
      openWithDefault: options.chooser !== true,
    };
    if (file.mimeType !== undefined) {
      args.contentType = file.mimeType;
    }
    return yield* callPlugin(
      fileOpenerPlugin.bridge,
      "open",
      fileOpenerPlugin.commands.open,
      args
    ).pipe(
      Effect.catchTag(
        "BridgeCallFailed",
        (error): Effect.Effect<never, IntentError> => {
          const { cause } = error;
          const code = hasErrorCode(cause) ? cause.code : undefined;
          // File opener 8.0.1 codes: 8 no activity or preview, 9 missing file.
          if (code === "8") {
            return Effect.fail(new NoHandler({ target }));
          }
          if (code === "9") {
            return Effect.fail(
              new Unavailable({ reason: `File not found: ${target}` })
            );
          }
          return Effect.fail(error);
        }
      ),
      Effect.asVoid
    );
  });

/** Default browser service for callers that only supply a Bridge layer. */
export const intentsLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserIntents>
) => effect.pipe(Effect.provide(BrowserIntentsLive));
interface OpenFileArgs {
  filePath: string;
  contentType?: string;
  openWithDefault: boolean;
}
