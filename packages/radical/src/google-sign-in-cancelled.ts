import { Schema } from "effect";

export class GoogleSignInCancelled extends Schema.TaggedError<GoogleSignInCancelled>()(
  "GoogleSignInCancelled",
  {}
) {}
