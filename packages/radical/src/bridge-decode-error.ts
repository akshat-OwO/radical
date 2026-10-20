import { Schema } from "effect";

export class BridgeDecodeError extends Schema.TaggedError<
  BridgeDecodeError,
  { readonly brand: unique symbol }
>()("BridgeDecodeError", {
  plugin: Schema.String,
  method: Schema.String,
  cause: Schema.Unknown,
}) {}
