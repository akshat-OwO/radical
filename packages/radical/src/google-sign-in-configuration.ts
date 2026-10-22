import { Context, Effect, Layer } from "effect";

// Replaced by the Vite plugin. OAuth client IDs are public identifiers.
declare const __RADICAL_GOOGLE_SIGN_IN__: unknown;
export class GoogleSignInConfiguration extends Context.Service<
  GoogleSignInConfiguration,
  { readonly read: Effect.Effect<unknown> }
>()("radical/GoogleSignInConfiguration") {}
export const GoogleSignInConfigurationLive = Layer.succeed(
  GoogleSignInConfiguration,
  {
    read: Effect.sync(() =>
      // oxlint-disable-next-line unicorn/no-typeof-undefined -- The build-time identifier may be absent outside Vite.
      typeof __RADICAL_GOOGLE_SIGN_IN__ === "undefined"
        ? undefined
        : __RADICAL_GOOGLE_SIGN_IN__
    ),
  }
);
