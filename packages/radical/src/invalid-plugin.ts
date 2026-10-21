import { Schema } from "effect";

export class InvalidPlugin extends Schema.TaggedError<
  InvalidPlugin,
  { readonly brand: unique symbol }
>()("InvalidPlugin", { message: Schema.String }) {}
