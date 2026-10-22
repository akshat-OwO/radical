import { Schema } from "effect";

export class OfflineBuildError extends Schema.TaggedError<
  OfflineBuildError,
  { readonly brand: unique symbol }
>()("OfflineBuildError", { cause: Schema.Unknown }) {}
