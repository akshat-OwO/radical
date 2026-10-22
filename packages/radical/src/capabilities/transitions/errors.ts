// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

export class TransitionFailed extends Schema.TaggedError<
  TransitionFailed,
  { readonly brand: unique symbol }
>()("TransitionFailed", { cause: Schema.Unknown }) {}

export class TransitionTimeout extends Schema.TaggedError<
  TransitionTimeout,
  { readonly brand: unique symbol }
>()("TransitionTimeout", { cause: Schema.Unknown }) {}
