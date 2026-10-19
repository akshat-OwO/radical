import { Schema } from "effect";

/** The skeleton reports operations whose host framework wiring is not built yet. */
export class AdapterUnavailable extends Schema.TaggedError<
  AdapterUnavailable,
  { readonly brand: unique symbol }
>()("AdapterUnavailable", { operation: Schema.String }) {}
