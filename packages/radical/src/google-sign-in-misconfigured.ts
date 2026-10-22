import { Schema } from "effect";

export class GoogleSignInMisconfigured extends Schema.TaggedError<GoogleSignInMisconfigured>()(
  "GoogleSignInMisconfigured",
  { cause: Schema.Unknown }
) {}
