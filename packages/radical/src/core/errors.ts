// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

export class Cancelled extends Schema.TaggedError<
  Cancelled,
  { readonly brand: unique symbol }
>()("Cancelled", {}) {}
export class PermissionDenied extends Schema.TaggedError<
  PermissionDenied,
  { readonly brand: unique symbol }
>()("PermissionDenied", {}) {}
export class Unavailable extends Schema.TaggedError<
  Unavailable,
  { readonly brand: unique symbol }
>()("Unavailable", { reason: Schema.String }) {}
