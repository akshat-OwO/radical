import { Schema } from "effect";

export class AndroidDeviceUnavailable extends Schema.TaggedError<
  AndroidDeviceUnavailable,
  { readonly brand: unique symbol }
>()("AndroidDeviceUnavailable", { message: Schema.String }) {}
