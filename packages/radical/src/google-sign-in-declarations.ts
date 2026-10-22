import { Effect, Schema } from "effect";

import { InvalidConfig } from "./config.ts";
import type { RadicalConfig } from "./config.ts";
import { GoogleSignInConfigSchema } from "./google-sign-in-schema.ts";

export const googleSignInDeclarations = (config: RadicalConfig) =>
  Effect.gen(function* () {
    if (config.internalPlugins?.googleSignIn !== true) {
      return "";
    }
    const options = yield* Schema.decodeUnknownEffect(GoogleSignInConfigSchema)(
      config.pluginOptions?.GoogleSignIn
    ).pipe(
      Effect.mapError(
        (error) =>
          new InvalidConfig({ message: `GoogleSignIn: ${error.message}` })
      )
    );
    const scheme = options.iosClientId.split(".").toReversed().join(".");
    return `<key>GIDClientID</key><string>${options.iosClientId}</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>${scheme}</string></array></dict></array>`;
  });
