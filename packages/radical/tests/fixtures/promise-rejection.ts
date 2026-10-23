import { Schema } from "effect";

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a class factory.
export class UnexpectedRejection extends Schema.TaggedError<
  UnexpectedRejection,
  { readonly brand: unique symbol }
>()("UnexpectedRejection", { cause: Schema.Unknown }) {}
