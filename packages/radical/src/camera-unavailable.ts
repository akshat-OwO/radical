import { Schema } from "effect";

export class Unavailable extends Schema.TaggedError<
  Unavailable,
  { readonly brand: unique symbol }
>()("Unavailable", { reason: Schema.String }) {}
