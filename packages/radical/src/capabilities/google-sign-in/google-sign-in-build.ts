import type { NativeContributions } from "../../vite/native-contributions.ts";
import type { GoogleSignInConfig } from "./google-sign-in-schema.ts";

export const googleSignInContributions = (
  options: GoogleSignInConfig
): NativeContributions => ({
  defines: { __RADICAL_GOOGLE_SIGN_IN__: JSON.stringify(options) },
  plist: [
    { key: "GIDClientID", value: `<string>${options.iosClientId}</string>` },
    {
      key: "CFBundleURLTypes",
      value: `<array><dict><key>CFBundleURLSchemes</key><array><string>${options.iosClientId.split(".").toReversed().join(".")}</string></array></dict></array>`,
    },
  ],
});

export const googleSignInDefaults = { __RADICAL_GOOGLE_SIGN_IN__: "null" };
