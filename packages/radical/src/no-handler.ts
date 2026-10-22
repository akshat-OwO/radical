import { Schema } from "effect";

export class NoHandler extends Schema.TaggedError<
  NoHandler,
  { readonly brand: unique symbol }
>()("NoHandler", { target: Schema.String }) {}
