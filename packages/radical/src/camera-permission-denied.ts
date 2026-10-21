import { Schema } from "effect";

export class PermissionDenied extends Schema.TaggedError<
  PermissionDenied,
  { readonly brand: unique symbol }
>()("PermissionDenied", {}) {}
