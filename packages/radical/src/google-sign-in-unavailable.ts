import { Schema } from "effect";

export class GoogleSignInUnavailable extends Schema.TaggedError<GoogleSignInUnavailable>()(
  "GoogleSignInUnavailable",
  {}
) {}
