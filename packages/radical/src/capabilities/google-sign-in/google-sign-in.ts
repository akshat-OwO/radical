import { Context, Effect, Layer, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import { googleSignInPlugin } from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import {
  GoogleSignInCancelled,
  GoogleSignInMisconfigured,
  GoogleSignInUnavailable,
} from "./errors.ts";
import {
  GoogleSignInConfiguration,
  GoogleSignInConfigurationLive,
} from "./google-sign-in-configuration.ts";
import type { GoogleIdentity } from "./google-sign-in-schema.ts";

export {
  GoogleSignInConfigSchema,
  GoogleIdentitySchema,
} from "./google-sign-in-schema.ts";
export type {
  GoogleIdentity,
  GoogleSignInConfig,
} from "./google-sign-in-schema.ts";
export { GoogleSignInCancelled } from "./errors.ts";
export { GoogleSignInMisconfigured } from "./errors.ts";
export { GoogleSignInUnavailable } from "./errors.ts";
export {
  GoogleSignInConfiguration,
  GoogleSignInConfigurationLive,
} from "./google-sign-in-configuration.ts";
export type GoogleSignInError =
  | BridgeError
  | GoogleSignInCancelled
  | GoogleSignInMisconfigured
  | GoogleSignInUnavailable;

export class BrowserGoogleSignIn extends Context.Service<
  BrowserGoogleSignIn,
  { readonly signIn: Effect.Effect<GoogleIdentity, GoogleSignInError> }
>()("radical/BrowserGoogleSignIn") {}
/** Native-only. Browser apps can provide their own OAuth flow through this service. */
export const BrowserGoogleSignInLive = Layer.succeed(BrowserGoogleSignIn, {
  signIn: Effect.fail(new GoogleSignInUnavailable({})),
});

const hasErrorCode = Schema.is(Schema.Struct({ code: Schema.Unknown }));
export const googleSignIn = Effect.gen(function* () {
  const bridge = yield* Bridge;
  if ((yield* bridge.runtime) === "browser") {
    return yield* (yield* BrowserGoogleSignIn).signIn;
  }
  const configuration = yield* GoogleSignInConfiguration;
  const config = yield* configuration.read;
  const { bridge: plugin, commands } = googleSignInPlugin;
  yield* callPlugin(plugin, "initialize", commands.initialize, {
    clientId: config.webClientId,
  }).pipe(
    Effect.catchTag("BridgeCallFailed", (cause) =>
      Effect.fail(new GoogleSignInMisconfigured({ cause }))
    )
  );
  return yield* callPlugin(plugin, "signIn", commands.signIn, {}).pipe(
    Effect.catchTag(
      "BridgeCallFailed",
      (error): Effect.Effect<never, GoogleSignInError> => {
        const { cause } = error;
        const code = hasErrorCode(cause) ? cause.code : undefined;
        if (code === "SIGN_IN_CANCELED") {
          return Effect.fail(new GoogleSignInCancelled({}));
        }
        return code === "PROVIDER_CONFIGURATION_ERROR"
          ? Effect.fail(new GoogleSignInMisconfigured({ cause }))
          : Effect.fail(error);
      }
    )
  );
});
export const googleSignInLive = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | BrowserGoogleSignIn | GoogleSignInConfiguration
  >
) =>
  effect.pipe(
    Effect.provide(
      Layer.merge(BrowserGoogleSignInLive, GoogleSignInConfigurationLive)
    )
  );
