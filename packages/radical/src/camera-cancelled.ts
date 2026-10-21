import { Schema } from "effect";

export class Cancelled extends Schema.TaggedError<
  Cancelled,
  { readonly brand: unique symbol }
>()("Cancelled", {}) {}
