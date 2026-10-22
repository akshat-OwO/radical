import { Schema } from "effect";

import { definePlugin } from "../../core/plugins/plugins.ts";
import {
  GoogleSignInConfigSchema,
  GoogleIdentitySchema,
} from "./google-sign-in-schema.ts";

export const googleSignInPlugin = definePlugin({
  id: "googleSignIn",
  bridge: "GoogleSignIn",
  dependencies: { "@capawesome/capacitor-google-sign-in": "0.1.4" },
  config: { selector: "GoogleSignIn", schema: GoogleSignInConfigSchema },
  commands: {
    initialize: {
      args: Schema.Struct({ clientId: Schema.NonEmptyString }),
      result: Schema.Unknown,
      errors: {},
    },
    signIn: {
      args: Schema.Struct({}),
      result: GoogleIdentitySchema,
      errors: {},
    },
  },
});
