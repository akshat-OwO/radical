import { Schema } from "effect";

export class TransitionFailed extends Schema.TaggedError<
  TransitionFailed,
  { readonly brand: unique symbol }
>()("TransitionFailed", { cause: Schema.Unknown }) {}
