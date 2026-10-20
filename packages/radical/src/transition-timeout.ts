import { Schema } from "effect";

export class TransitionTimeout extends Schema.TaggedError<
  TransitionTimeout,
  { readonly brand: unique symbol }
>()("TransitionTimeout", { cause: Schema.Unknown }) {}
