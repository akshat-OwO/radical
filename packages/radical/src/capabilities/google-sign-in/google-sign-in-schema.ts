import { Schema } from "effect";

const clientId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u)
);

export const GoogleSignInConfigSchema = Schema.Struct({
  webClientId: clientId,
  iosClientId: clientId,
});

export type GoogleSignInConfig = typeof GoogleSignInConfigSchema.Type;

export const GoogleIdentitySchema = Schema.Struct({
  idToken: Schema.NonEmptyString,
});

export type GoogleIdentity = typeof GoogleIdentitySchema.Type;
