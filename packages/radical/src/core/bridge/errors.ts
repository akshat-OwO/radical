// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

export class BridgeCallFailed extends Schema.TaggedError<
  BridgeCallFailed,
  { readonly brand: unique symbol }
>()("BridgeCallFailed", {
  plugin: Schema.String,
  method: Schema.String,
  cause: Schema.Unknown,
}) {}
export class BridgeDecodeError extends Schema.TaggedError<
  BridgeDecodeError,
  { readonly brand: unique symbol }
>()("BridgeDecodeError", {
  plugin: Schema.String,
  method: Schema.String,
  cause: Schema.Unknown,
}) {}
export class BridgeUnavailable extends Schema.TaggedError<
  BridgeUnavailable,
  { readonly brand: unique symbol }
>()("BridgeUnavailable", { plugin: Schema.String, method: Schema.String }) {}
