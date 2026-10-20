import { Schema } from "effect";

export class BridgeUnavailable extends Schema.TaggedError<
  BridgeUnavailable,
  { readonly brand: unique symbol }
>()("BridgeUnavailable", { plugin: Schema.String, method: Schema.String }) {}
