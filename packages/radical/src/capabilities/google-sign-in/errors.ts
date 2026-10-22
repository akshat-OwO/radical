// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

export class GoogleSignInCancelled extends Schema.TaggedError<GoogleSignInCancelled>()(
  "GoogleSignInCancelled",
  {}
) {}

export class GoogleSignInMisconfigured extends Schema.TaggedError<GoogleSignInMisconfigured>()(
  "GoogleSignInMisconfigured",
  { cause: Schema.Unknown }
) {}

export class GoogleSignInUnavailable extends Schema.TaggedError<GoogleSignInUnavailable>()(
  "GoogleSignInUnavailable",
  {}
) {}
