// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

export class AndroidBootTimeout extends Schema.TaggedError<
  AndroidBootTimeout,
  { readonly brand: unique symbol }
>()("AndroidBootTimeout", { target: Schema.String, serial: Schema.String }) {
  override get message() {
    return `Android target ${this.target} (${this.serial}) did not finish booting within 120 seconds`;
  }
}
export class AndroidDeviceUnavailable extends Schema.TaggedError<
  AndroidDeviceUnavailable,
  { readonly brand: unique symbol }
>()("AndroidDeviceUnavailable", { message: Schema.String }) {}
