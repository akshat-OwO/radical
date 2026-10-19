import { Schema } from "effect";

export class NavigationFailed extends Schema.TaggedError<
  NavigationFailed,
  { readonly brand: unique symbol }
>()("NavigationFailed", { cause: Schema.Unknown }) {}
