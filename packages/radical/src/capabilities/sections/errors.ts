import { Schema } from "effect";

export class InvalidSection extends Schema.TaggedError<
  InvalidSection,
  { readonly brand: unique symbol }
>()("InvalidSection", {
  message: Schema.String,
}) {}
