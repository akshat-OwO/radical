import { Schema } from "effect";

export class RequestFailed extends Schema.TaggedError<
  RequestFailed,
  { readonly brand: unique symbol }
>()("RequestFailed", { cause: Schema.Unknown }) {}
