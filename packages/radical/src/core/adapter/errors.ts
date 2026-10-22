// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

/** The skeleton reports operations whose host framework wiring is not built yet. */
export class AdapterUnavailable extends Schema.TaggedError<
  AdapterUnavailable,
  { readonly brand: unique symbol }
>()("AdapterUnavailable", { operation: Schema.String }) {}
export class NavigationFailed extends Schema.TaggedError<
  NavigationFailed,
  { readonly brand: unique symbol }
>()("NavigationFailed", { cause: Schema.Unknown }) {}
