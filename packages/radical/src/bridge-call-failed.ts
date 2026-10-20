import { Schema } from "effect";

export class BridgeCallFailed extends Schema.TaggedError<
  BridgeCallFailed,
  { readonly brand: unique symbol }
>()("BridgeCallFailed", {
  plugin: Schema.String,
  method: Schema.String,
  cause: Schema.Unknown,
}) {}
