import { Schema } from "effect";

export class InvalidAsset extends Schema.TaggedError<InvalidAsset>()(
  "InvalidAsset",
  {
    message: Schema.String,
  }
) {}
